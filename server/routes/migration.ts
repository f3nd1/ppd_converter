import { Router } from 'express'
import { z } from 'zod'
import { recordActivity } from '../lib/activity.ts'
import { makeAIClient } from '../lib/ai/client.ts'
import { prisma } from '../lib/db.ts'
import { googleClients } from '../lib/google/session-client.ts'
import { handler, HttpError, parseBody, rateLimit , param } from '../lib/http.ts'
import { newCorrelationId } from '../lib/logger.ts'
import { drainQueue, isQueueRunning } from '../lib/migration/worker.ts'
import { canRunMigration, evaluateApprovalGate } from '../lib/validation/gate.ts'

export const migrationRouter = Router()

/** The single source of truth for whether migration may run at all. */
export async function migrationReadiness() {
  const [template, instruction, mapping] = await Promise.all([
    prisma.templateVersion.findFirst({ where: { isActive: true } }),
    prisma.aIInstructionVersion.findFirst({ where: { isActive: true } }),
    prisma.mappingVersion.findFirst({ where: { isActive: true, approvalStatus: 'approved' } }),
  ])
  return canRunMigration({
    hasApprovedActiveMapping: Boolean(mapping),
    hasActiveTemplate: Boolean(template),
    hasActiveAIInstruction: Boolean(instruction),
  })
}

migrationRouter.get(
  '/migration/readiness',
  handler(async (_req, res) => res.json(await migrationReadiness())),
)

migrationRouter.post(
  '/migration/queue',
  rateLimit('migration_queue', 30, 60_000),
  handler(async (req, res) => {
    const input = parseBody(
      z.object({ sourceDocumentIds: z.array(z.string().min(1)).min(1).max(200) }),
      req.body,
    )

    // Checked SERVER-SIDE. The UI disabling a button is a convenience; this is
    // what actually keeps production migration blocked without an approved mapping.
    const readiness = await migrationReadiness()
    if (!readiness.allowed) {
      await recordActivity({
        action: 'migration_queued',
        result: 'blocked',
        summary: readiness.blockers.join(' '),
        correlationId: req.correlationId,
      })
      throw new HttpError(409, readiness.blockers.join(' '))
    }

    const [template, instruction, mapping] = await Promise.all([
      prisma.templateVersion.findFirst({ where: { isActive: true } }),
      prisma.aIInstructionVersion.findFirst({ where: { isActive: true } }),
      prisma.mappingVersion.findFirst({ where: { isActive: true, approvalStatus: 'approved' } }),
    ])

    const queued: string[] = []
    const skipped: { id: string; reason: string }[] = []

    for (const sourceDocumentId of input.sourceDocumentIds) {
      const existing = await prisma.migrationJob.findFirst({
        where: { sourceDocumentId, stage: { notIn: ['failed', 'exported'] } },
      })
      if (existing) {
        skipped.push({ id: sourceDocumentId, reason: 'Already queued or migrated.' })
        continue
      }
      const job = await prisma.migrationJob.create({
        data: {
          sourceDocumentId,
          stage: 'queued',
          correlationId: newCorrelationId(),
          // Frozen at queue time so a later activation cannot retroactively
          // change what a completed migration was run against.
          templateVersionId: template?.id,
          aiInstructionVersionId: instruction?.id,
          mappingVersionId: mapping?.id,
        },
      })
      await prisma.sourceDocument.update({
        where: { id: sourceDocumentId },
        data: { migrationStatus: 'queued' },
      })
      queued.push(job.id)
    }

    await recordActivity({
      action: 'migration_queued',
      entityType: 'MigrationJob',
      summary: `Queued ${queued.length} document(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`,
      correlationId: req.correlationId,
    })

    // Runs in the background; the HTTP request never waits for a migration.
    void startQueue()

    res.status(202).json({ queued, skipped })
  }),
)

migrationRouter.post(
  '/migration/:jobId/retry',
  handler(async (req, res) => {
    const job = await prisma.migrationJob.findUnique({ where: { id: param(req, 'jobId') } })
    if (!job) throw new HttpError(404, 'That migration job does not exist.')
    if (job.stage !== 'failed') throw new HttpError(400, 'Only a failed job can be retried.')

    const updated = await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        stage: 'queued',
        attempt: job.attempt + 1,
        errorMessage: null,
        errorRef: null,
        startedAt: null,
        finishedAt: null,
      },
    })
    await recordActivity({
      action: 'migration_retry',
      entityType: 'MigrationJob',
      entityId: job.id,
      summary: `Retry attempt ${updated.attempt}`,
      correlationId: req.correlationId,
    })
    void startQueue()
    res.json({ job: updated })
  }),
)

migrationRouter.get(
  '/migration/status',
  handler(async (_req, res) => {
    const jobs = await prisma.migrationJob.findMany({
      orderBy: { queuedAt: 'desc' },
      take: 100,
      include: {
        sourceDocument: { select: { id: true, title: true } },
        migratedDocument: { select: { id: true, targetTitle: true, targetUrl: true, status: true } },
      },
    })
    res.json({ jobs, running: isQueueRunning() })
  }),
)

migrationRouter.get(
  '/migrated-documents/:id',
  handler(async (req, res) => {
    const doc = await prisma.migratedDocument.findUnique({
      where: { id: param(req, 'id') },
      include: {
        sourceDocument: {
          include: { sourceMapping: { include: { subCriterion: { include: { criterion: true } } } } },
        },
        changes: { orderBy: { changeNumber: 'asc' } },
        validationRuns: { include: { items: true }, orderBy: { startedAt: 'asc' } },
        reviewDecisions: { orderBy: { decidedAt: 'desc' } },
        migrationJob: true,
        templateVersion: true,
      },
    })
    if (!doc) throw new HttpError(404, 'That migrated document does not exist.')

    const items = doc.validationRuns.flatMap((r) => r.items)
    res.json({
      document: doc,
      gate: evaluateApprovalGate(
        items.map((i) => ({
          result: i.result as 'pass' | 'warning' | 'fail',
          resolutionStatus: i.resolutionStatus as 'open' | 'resolved' | 'acknowledged' | 'false_positive',
        })),
      ),
    })
  }),
)

migrationRouter.post(
  '/validation-items/:id/resolve',
  handler(async (req, res) => {
    const input = parseBody(
      z.object({
        resolutionStatus: z.enum(['resolved', 'acknowledged', 'false_positive']),
        resolutionNote: z.string().trim().max(2000).optional(),
      }),
      req.body,
    )
    // Marking a false positive without saying why would make the audit trail
    // useless — the justification is required, not optional.
    if (input.resolutionStatus === 'false_positive' && !input.resolutionNote) {
      throw new HttpError(400, 'A false positive needs a written justification.')
    }

    const updated = await prisma.validationItem.update({
      where: { id: param(req, 'id') },
      data: { ...input, resolvedAt: new Date() },
    })
    await recordActivity({
      action: 'warning_resolution',
      entityType: 'ValidationItem',
      entityId: updated.id,
      summary: `${input.resolutionStatus}: ${updated.checkPerformed}`,
      correlationId: req.correlationId,
    })
    res.json({ item: updated })
  }),
)

migrationRouter.post(
  '/review/:migratedDocId/decision',
  handler(async (req, res) => {
    const input = parseBody(
      z.object({
        decision: z.enum(['approved', 'returned_for_correction']),
        comment: z.string().trim().max(4000).optional(),
      }),
      req.body,
    )

    const doc = await prisma.migratedDocument.findUnique({
      where: { id: param(req, 'migratedDocId') },
      include: { validationRuns: { include: { items: true } }, migrationJob: true },
    })
    if (!doc) throw new HttpError(404, 'That migrated document does not exist.')

    const items = doc.validationRuns.flatMap((r) => r.items)
    const gate = evaluateApprovalGate(
      items.map((i) => ({
        result: i.result as 'pass' | 'warning' | 'fail',
        resolutionStatus: i.resolutionStatus as 'open' | 'resolved' | 'acknowledged' | 'false_positive',
      })),
    )

    // The gate is enforced here, not in the UI. Approval with an unresolved
    // failure is the one outcome the brief forbids outright.
    if (input.decision === 'approved' && !gate.canApprove) {
      await recordActivity({
        action: 'approval',
        entityType: 'MigratedDocument',
        entityId: doc.id,
        result: 'blocked',
        summary: gate.blockers.join(' '),
        correlationId: req.correlationId,
      })
      throw new HttpError(409, gate.blockers.join(' '))
    }

    const decision = await prisma.reviewDecision.create({
      data: {
        migratedDocumentId: doc.id,
        reviewerEmail: req.session?.email ?? 'unknown',
        decision: input.decision,
        comment: input.comment ?? null,
        aiInstructionVersionId: doc.migrationJob.aiInstructionVersionId,
        mappingVersionId: doc.migrationJob.mappingVersionId,
        templateVersionId: doc.templateVersionId,
        sourceModifiedTime: doc.sourceModifiedTimeAtMigration,
        targetGoogleDocId: doc.targetGoogleDocId,
        validationSummary: `${gate.unresolvedFailures} unresolved failure(s), ${gate.unacknowledgedWarnings} unacknowledged warning(s)`,
      },
    })

    const status = input.decision === 'approved' ? 'approved' : 'returned_for_correction'
    await prisma.migratedDocument.update({ where: { id: doc.id }, data: { status } })
    await prisma.migrationJob.update({
      where: { id: doc.migrationJobId },
      data: { stage: input.decision === 'approved' ? 'approved' : 'awaiting_review' },
    })
    await prisma.sourceDocument.update({
      where: { id: doc.sourceDocumentId },
      data: { migrationStatus: status },
    })

    await recordActivity({
      action: input.decision === 'approved' ? 'approval' : 'return_for_correction',
      entityType: 'MigratedDocument',
      entityId: doc.id,
      summary: `${input.decision} by ${decision.reviewerEmail}`,
      correlationId: req.correlationId,
    })

    res.status(201).json({ decision })
  }),
)

/** Background drain. Clients are built per drain so a token refresh is picked up. */
async function startQueue(): Promise<void> {
  if (isQueueRunning()) return
  try {
    const { drive, docs } = await googleClients()
    await drainQueue({ drive, docs, ai: makeAIClient() })
  } catch (err) {
    // Queue-level failure (no Google connection, no OpenAI key) is recorded
    // rather than thrown into a request that has already returned 202.
    await recordActivity({
      action: 'migration_failed',
      result: 'failure',
      summary: `Queue could not start: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
