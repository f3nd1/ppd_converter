import { recordActivity } from '../activity.ts'
import { AIError, type AIClient, withBoundedRetry } from '../ai/client.ts'
import { RewriteOutput, AIValidationOutput } from '../ai/schemas.ts'
import {
  rewriteSystemPrompt,
  rewriteUserPrompt,
  VALIDATION_SYSTEM_PROMPT,
  validationUserPrompt,
} from '../ai/prompts.ts'
import { prisma } from '../db.ts'
import { buildMetadataRequests, buildPopulateRequests, sectionsFromRewrite } from '../doc/generate.ts'
import type { DocBlock } from '../doc/model.ts'
import { parseGoogleDoc } from '../doc/parse.ts'
import { buildOutputTitle, splitDocumentCode } from '../doc/title.ts'
import { OUTPUT_VERSION } from '../enums.ts'
import type { DocsClient } from '../google/docs.ts'
import type { DriveClient } from '../google/drive.ts'
import { documentUrl } from '../google/urls.ts'
import { log } from '../logger.ts'
import { runDeterministicValidation } from '../validation/deterministic.ts'
import { buildChangeRecords } from './changes.ts'
import { mapBlocks, type Rule, targetSectionsFor } from './mapping.ts'
import { runPrechecks } from './prechecks.ts'

// One document at a time. The MigrationJob table IS the queue — no Redis, no
// Celery, no in-memory job list that a restart would lose. Stage is persisted
// after every step, so an interrupted job is always diagnosable and is retried
// explicitly rather than silently resumed.

export class SourceProtectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceProtectionError'
  }
}

/**
 * The guard that actually keeps source documents read-only. Every write goes
 * through here first. A bug elsewhere that pointed a batchUpdate at a source id
 * throws instead of modifying a controlled document — the one failure the brief
 * treats as unacceptable.
 */
export function assertWritableTarget(targetDocId: string, sourceDocId: string): void {
  if (!targetDocId) throw new SourceProtectionError('Refusing to write: no target document id.')
  if (targetDocId === sourceDocId) {
    throw new SourceProtectionError(
      `Refusing to write to ${targetDocId}: it is the SOURCE document. Source documents are never modified.`,
    )
  }
}

export type Clients = { drive: DriveClient; docs: DocsClient; ai: AIClient }

async function setStage(jobId: string, stage: string, extra: Record<string, unknown> = {}) {
  await prisma.migrationJob.update({ where: { id: jobId }, data: { stage, ...extra } })
  await recordActivity({
    action: 'migration_stage_changed',
    entityType: 'MigrationJob',
    entityId: jobId,
    summary: `Stage: ${stage}`,
  })
}

export async function runJob(jobId: string, clients: Clients): Promise<void> {
  const job = await prisma.migrationJob.findUnique({
    where: { id: jobId },
    include: { sourceDocument: { include: { sourceMapping: true } } },
  })
  if (!job) throw new Error(`Migration job ${jobId} not found.`)

  const source = job.sourceDocument
  const destinationFolderId = source.sourceMapping.newResourceId ?? ''
  const correlationId = job.correlationId

  try {
    await setStage(jobId, 'reading_source', { startedAt: new Date() })

    const [template, instruction, mapping] = await Promise.all([
      prisma.templateVersion.findFirst({ where: { isActive: true } }),
      prisma.aIInstructionVersion.findFirst({ where: { isActive: true } }),
      prisma.mappingVersion.findFirst({
        where: { isActive: true, approvalStatus: 'approved' },
        include: { rules: true },
      }),
    ])

    const liveFile = await clients.drive.getFile(source.googleFileId).catch(() => null)
    const targetTitle = buildOutputTitle(
      splitDocumentCode(source.title),
      OUTPUT_VERSION,
    )
    const existingTarget = destinationFolderId
      ? await clients.drive.findByNameInFolder(destinationFolderId, targetTitle).catch(() => null)
      : null

    const precheck = runPrechecks({
      sourceAccessible: Boolean(liveFile),
      destinationFolderAccessible: Boolean(destinationFolderId),
      activeTemplateValid: Boolean(template),
      activeAIInstructionExists: Boolean(instruction),
      approvedActiveMappingExists: Boolean(mapping),
      requiredMetadataPresent: Boolean(source.title),
      targetAlreadyExists: Boolean(existingTarget),
      sourceModifiedTimeNow: liveFile ? new Date(liveFile.modifiedTime) : null,
      sourceModifiedTimeAtScan: source.modifiedTime,
    })
    if (!precheck.passed) throw new Error(precheck.failures.join(' '))

    // Non-null after prechecks, but narrowed explicitly rather than asserted.
    if (!template || !instruction || !mapping) throw new Error('Missing active configuration.')

    // --- parse -------------------------------------------------------------
    await setStage(jobId, 'parsing_structure')
    const rawDoc = await clients.docs.getDocument(source.googleFileId)
    const model = parseGoogleDoc(rawDoc, { modifiedTime: liveFile?.modifiedTime })

    await prisma.contentBlock.deleteMany({ where: { sourceDocumentId: source.id } })
    await prisma.contentBlock.createMany({
      data: model.blocks.map((b) => ({
        sourceDocumentId: source.id,
        blockId: b.blockId,
        type: b.type,
        text: b.text,
        textHash: b.textHash,
        level: b.level ?? null,
        styleName: b.styleName ?? null,
        numbering: b.numbering ? JSON.stringify(b.numbering) : null,
        links: JSON.stringify(b.links),
        tableData: b.table ? JSON.stringify(b.table) : null,
        imageRef: b.imageRef ? JSON.stringify(b.imageRef) : null,
        sourceLocation: b.sourceLocation ? JSON.stringify(b.sourceLocation) : null,
        order: b.order,
      })),
    })

    // --- map ---------------------------------------------------------------
    await setStage(jobId, 'mapping_content')
    const rules: Rule[] = mapping.rules.map((r) => ({
      id: r.id,
      oldSectionName: r.oldSectionName,
      newTargetSection: r.newTargetSection,
      transformationRule: r.transformationRule,
      priority: r.priority,
      isActive: r.isActive,
    }))
    const mappings = mapBlocks(model.blocks, rules)
    const targetSectionNames = targetSectionsFor(rules)

    // --- generate ----------------------------------------------------------
    await setStage(jobId, 'generating_content')
    const rewrite = await withBoundedRetry(() =>
      clients.ai.structured({
        schema: RewriteOutput,
        schemaName: 'ppd_rewrite',
        system: rewriteSystemPrompt(instruction.body, targetSectionNames),
        user: rewriteUserPrompt({
          documentTitle: model.metadata.documentTitle,
          documentCode: model.metadata.documentCode,
          blocks: model.blocks,
          mappingRules: rules,
        }),
      }),
    )
    const sections = sectionsFromRewrite(rewrite.data)

    // --- copy the template -------------------------------------------------
    await setStage(jobId, 'copying_template')
    const copy = await clients.drive.copyFile(
      template.googleDocId,
      targetTitle,
      destinationFolderId,
    )

    // --- write -------------------------------------------------------------
    await setStage(jobId, 'writing_target')
    assertWritableTarget(copy.id, source.googleFileId)
    await clients.docs.batchUpdate(copy.id, [
      ...buildMetadataRequests({
        documentCode: model.metadata.documentCode,
        documentTitle: model.metadata.documentTitle,
        outputVersion: OUTPUT_VERSION,
      }),
      ...buildPopulateRequests(sections, targetSectionNames),
    ])

    const migrated = await prisma.migratedDocument.create({
      data: {
        migrationJobId: jobId,
        sourceDocumentId: source.id,
        targetGoogleDocId: copy.id,
        targetUrl: documentUrl(copy.id),
        targetTitle,
        outputVersion: OUTPUT_VERSION,
        destinationFolderId,
        sourceModifiedTimeAtMigration: liveFile
          ? new Date(liveFile.modifiedTime)
          : source.modifiedTime,
        templateVersionId: template.id,
        status: 'awaiting_review',
      },
    })

    await prisma.contentBlockMapping.createMany({
      data: await Promise.all(
        mappings.map(async (m) => {
          const block = await prisma.contentBlock.findFirst({
            where: { sourceDocumentId: source.id, blockId: m.blockId },
            select: { id: true },
          })
          return {
            contentBlockId: block!.id,
            targetSection: m.targetSection,
            mappingRuleId: m.mappingRuleId,
            status: m.status,
            note: m.note ?? null,
            migratedDocumentId: migrated.id,
          }
        }),
      ),
    })

    const changes = buildChangeRecords({
      rewrite: rewrite.data,
      blocks: model.blocks,
      mappings,
      sections,
    })
    await prisma.changeRecord.createMany({
      data: changes.map((c) => ({ ...c, migratedDocumentId: migrated.id })),
    })

    // --- validate ----------------------------------------------------------
    await setStage(jobId, 'validating')
    await runValidation({
      migratedDocumentId: migrated.id,
      blocks: model.blocks,
      mappings,
      sections,
      requiredTargetSections: targetSectionNames,
      sourceDocumentCode: model.metadata.documentCode,
      targetTitle,
      expectedDestinationFolderId: destinationFolderId,
      actualDestinationFolderId: destinationFolderId,
      expectedTemplateId: template.googleDocId,
      actualTemplateId: template.googleDocId,
      sourceModifiedTimeAtScan: source.modifiedTime,
      sourceModifiedTimeNow: liveFile ? new Date(liveFile.modifiedTime) : source.modifiedTime,
      duplicateTargetFound: false,
      requiredMetadataPresent: true,
      ai: clients.ai,
    })

    await setStage(jobId, 'awaiting_review', { finishedAt: new Date() })
    await prisma.sourceDocument.update({
      where: { id: source.id },
      data: { migrationStatus: 'awaiting_review', contentHash: model.blocks[0]?.textHash ?? null },
    })
    await recordActivity({
      action: 'migration_completed',
      entityType: 'MigratedDocument',
      entityId: migrated.id,
      summary: `Created "${targetTitle}"`,
      correlationId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('migration job failed', { jobId, correlationId, message })
    await prisma.migrationJob.update({
      where: { id: jobId },
      data: { stage: 'failed', finishedAt: new Date(), errorMessage: message, errorRef: correlationId },
    })
    await prisma.sourceDocument
      .update({ where: { id: source.id }, data: { migrationStatus: 'failed' } })
      .catch(() => {})
    await recordActivity({
      action: 'migration_failed',
      entityType: 'MigrationJob',
      entityId: jobId,
      result: 'failure',
      summary: message.slice(0, 500),
      errorRef: correlationId,
      correlationId,
    })
    throw err
  }
}

/** Both validation layers. Deterministic first — it is authoritative. */
export async function runValidation(args: {
  migratedDocumentId: string
  blocks: DocBlock[]
  mappings: { blockId: string; status: 'mapped' | 'unmapped' | 'ambiguous' }[]
  sections: { name: string; content: string }[]
  requiredTargetSections: string[]
  sourceDocumentCode: string | null
  targetTitle: string
  expectedDestinationFolderId: string
  actualDestinationFolderId: string
  expectedTemplateId: string | null
  actualTemplateId: string | null
  sourceModifiedTimeAtScan: Date
  sourceModifiedTimeNow: Date
  duplicateTargetFound: boolean
  requiredMetadataPresent: boolean
  ai: AIClient
}): Promise<void> {
  const deterministic = runDeterministicValidation({
    sourceBlocks: args.blocks,
    blockMappings: new Map(args.mappings.map((m) => [m.blockId, m.status])),
    targetSections: args.sections,
    requiredTargetSections: args.requiredTargetSections,
    sourceDocumentCode: args.sourceDocumentCode,
    targetTitle: args.targetTitle,
    expectedDestinationFolderId: args.expectedDestinationFolderId,
    actualDestinationFolderId: args.actualDestinationFolderId,
    expectedTemplateId: args.expectedTemplateId,
    actualTemplateId: args.actualTemplateId,
    sourceModifiedTimeAtScan: args.sourceModifiedTimeAtScan,
    sourceModifiedTimeNow: args.sourceModifiedTimeNow,
    duplicateTargetFound: args.duplicateTargetFound,
    requiredMetadataPresent: args.requiredMetadataPresent,
  })

  const detRun = await prisma.validationRun.create({
    data: {
      migratedDocumentId: args.migratedDocumentId,
      layer: 'deterministic',
      finishedAt: new Date(),
      summary: summarise(deterministic),
    },
  })
  await prisma.validationItem.createMany({
    data: deterministic.map((r) => ({
      validationRunId: detRun.id,
      category: r.category,
      checkPerformed: r.checkPerformed,
      result: r.result,
      details: r.details,
      severity: r.severity,
      sourceReference: r.sourceReference ?? null,
      targetReference: r.targetReference ?? null,
      humanReviewRequired: r.humanReviewRequired,
    })),
  })

  // Second layer: a separate call with a separate prompt. Advisory only — its
  // items are stored for a human, never used to override layer 1.
  const aiRun = await prisma.validationRun.create({
    data: { migratedDocumentId: args.migratedDocumentId, layer: 'ai' },
  })
  try {
    const result = await withBoundedRetry(() =>
      args.ai.structured({
        schema: AIValidationOutput,
        schemaName: 'ppd_validation',
        system: VALIDATION_SYSTEM_PROMPT,
        user: validationUserPrompt({ sourceBlocks: args.blocks, targetSections: args.sections }),
      }),
    )
    await prisma.validationItem.createMany({
      data: result.data.items.map((i) => ({
        validationRunId: aiRun.id,
        category: i.category,
        checkPerformed: 'AI comparison of source and migrated content',
        result: i.result,
        details: i.details,
        severity: i.severity,
        sourceReference: i.sourceReference,
        targetReference: i.targetReference,
        humanReviewRequired: i.humanReviewRequired,
      })),
    })
    await prisma.validationRun.update({
      where: { id: aiRun.id },
      data: {
        finishedAt: new Date(),
        summary: result.data.summary,
        model: result.model,
        providerRequestId: result.providerRequestId,
        usageJson: result.usage ? JSON.stringify(result.usage) : null,
      },
    })
  } catch (err) {
    // A failed AI validation is recorded as a failure needing human review —
    // never as a pass, and never silently skipped.
    const message = err instanceof AIError || err instanceof Error ? err.message : String(err)
    await prisma.validationItem.create({
      data: {
        validationRunId: aiRun.id,
        category: 'meaning_preservation',
        checkPerformed: 'AI comparison of source and migrated content',
        result: 'fail',
        details: `The AI validation pass did not complete: ${message}. This document cannot be approved until it runs successfully or the failure is explicitly resolved.`,
        severity: 'high',
        humanReviewRequired: true,
      },
    })
    await prisma.validationRun.update({
      where: { id: aiRun.id },
      data: { finishedAt: new Date(), summary: 'AI validation failed to complete.' },
    })
  }
}

function summarise(results: { result: string }[]): string {
  const counts = { pass: 0, warning: 0, fail: 0 } as Record<string, number>
  for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1
  return `${counts.pass ?? 0} passed, ${counts.warning ?? 0} warning(s), ${counts.fail ?? 0} failure(s)`
}

// --- serial queue ----------------------------------------------------------

let running = false

/**
 * Processes queued jobs one at a time. Serial by design: it protects both the
 * server's memory (one document model in flight) and the Google/OpenAI rate
 * limits, and it is what the brief asks for.
 */
export async function drainQueue(clients: Clients): Promise<number> {
  if (running) return 0
  running = true
  let processed = 0
  try {
    for (;;) {
      const next = await prisma.migrationJob.findFirst({
        where: { stage: 'queued' },
        orderBy: { queuedAt: 'asc' },
      })
      if (!next) break
      try {
        await runJob(next.id, clients)
      } catch {
        // runJob already recorded the failure; keep going so one bad document
        // does not stall the rest of the queue.
      }
      processed += 1
    }
  } finally {
    running = false
  }
  return processed
}

export function isQueueRunning(): boolean {
  return running
}
