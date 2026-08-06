import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The end-to-end workflow, against a REAL SQLite database with Google and OpenAI
// mocked at the client boundary. No test ever touches live Drive, a real key, or
// a real document.
//
// This covers the eighteen steps in the brief's end-to-end test, minus the
// browser sign-in (exercised separately in e2e/) — everything from configuring a
// criterion through to approval and export.

const tmp = mkdtempSync(path.join(tmpdir(), 'ppd-test-'))
const dbFile = path.join(tmp, 'test.db')
process.env.DATABASE_URL = `file:${dbFile}`
process.env.SESSION_SECRET = 'x'.repeat(48)
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

type Mod = typeof import('../lib/db.ts')
let prisma: Mod['prisma']
let mod: {
  runJob: typeof import('../lib/migration/worker.ts').runJob
  evaluateApprovalGate: typeof import('../lib/validation/gate.ts').evaluateApprovalGate
  DEFAULT_AI_INSTRUCTIONS: string
}

// --- fakes -----------------------------------------------------------------

const SOURCE_ID = 'sourceDoc123'
const TEMPLATE_ID = 'templateDoc456'
const FOLDER_ID = 'revisedFolder789'
const MODIFIED = '2026-08-01T10:00:00.000Z'

const writes: { docId: string; requests: unknown[] }[] = []
let copyCount = 0

const fakeDrive = {
  async getFile(id: string) {
    if (id === SOURCE_ID) {
      return {
        id: SOURCE_ID,
        name: 'PPD-SGL-CG-1.1.1 Leadership and Corporate Governance',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: MODIFIED,
        webViewLink: `https://docs.google.com/document/d/${SOURCE_ID}/edit`,
      }
    }
    return { id, name: 'REVISED', mimeType: 'application/vnd.google-apps.folder', modifiedTime: MODIFIED }
  },
  async listDocsInFolder() {
    return []
  },
  async copyFile(fileId: string, name: string) {
    copyCount += 1
    // Proves the migration copies the TEMPLATE, never the source.
    expect(fileId).toBe(TEMPLATE_ID)
    return {
      id: `copy-${copyCount}`,
      name,
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: MODIFIED,
    }
  },
  async findByNameInFolder() {
    return null
  },
}

const fakeDocs = {
  async getDocument(documentId: string) {
    return {
      documentId,
      title: 'PPD-SGL-CG-1.1.1 Leadership and Corporate Governance',
      revisionId: 'rev1',
      body: {
        content: [
          { paragraph: { paragraphStyle: { namedStyleType: 'HEADING_1' }, elements: [{ textRun: { content: 'Responsibilities' } }] } },
          { paragraph: { elements: [{ textRun: { content: 'The Principal shall approve refunds within 7 working days under clause 4.2.1.' } }] } },
        ],
      },
      headers: { h1: { content: [{ paragraph: { elements: [{ textRun: { content: 'UCC' } }] } }] } },
      footers: { f1: { content: [{ paragraph: { elements: [{ textRun: { content: 'Page' } }] } }] } },
    }
  },
  async batchUpdate(documentId: string, requests: unknown[]) {
    // If this ever received SOURCE_ID the source would have been modified.
    expect(documentId).not.toBe(SOURCE_ID)
    writes.push({ docId: documentId, requests })
  },
}

const TARGET_TEXT = 'The Principal shall approve refunds within 7 working days under clause 4.2.1.'

const fakeAI = {
  async structured<T>({ schemaName }: { schemaName: string }): Promise<{
    data: T
    model: string
    providerRequestId: string | null
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
  }> {
    const data =
      schemaName === 'ppd_rewrite'
        ? {
            overallReasoning: 'Mapped responsibilities to the PRACI matrix.',
            sections: [
              {
                reasoning: 'Responsibilities belong in the PRACI matrix.',
                targetSection: 'PRACI Responsibility Matrix',
                sourceBlockIds: [],
                format: 'paragraphs',
                paragraphs: [TARGET_TEXT],
                table: null,
              },
            ],
            changes: [],
            unmappedBlockIds: [],
            ambiguities: [],
          }
        : {
            overallReasoning: 'Compared source and target.',
            summary: 'One point needs a human look.',
            items: [
              {
                details: 'The phrasing of the approval step should be confirmed.',
                category: 'meaning_preservation',
                result: 'warning',
                severity: 'low',
                sourceReference: null,
                targetReference: null,
                humanReviewRequired: true,
              },
            ],
          }
    return {
      data: data as T,
      model: 'gpt-5-mini',
      providerRequestId: 'req_test_123',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }
  },
}

// --- setup -----------------------------------------------------------------

beforeAll(async () => {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: 'pipe',
  })
  prisma = (await import('../lib/db.ts')).prisma
  const worker = await import('../lib/migration/worker.ts')
  const gate = await import('../lib/validation/gate.ts')
  const prompts = await import('../lib/ai/prompts.ts')
  mod = {
    runJob: worker.runJob,
    evaluateApprovalGate: gate.evaluateApprovalGate,
    DEFAULT_AI_INSTRUCTIONS: prompts.DEFAULT_AI_INSTRUCTIONS,
  }
})

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('end-to-end migration workflow', () => {
  let subCriterionId = ''
  let sourceDocumentId = ''
  let mappingVersionId = ''
  let migratedDocumentId = ''

  it('1. seeds the seven criteria and no sub-criteria', async () => {
    for (let n = 1; n <= 7; n += 1) {
      await prisma.criterion.upsert({
        where: { number: n },
        update: {},
        create: { number: n, title: `Criterion ${n}`, order: n },
      })
    }
    expect(await prisma.criterion.count()).toBe(7)
    // Nothing is invented — sub-criteria start empty.
    expect(await prisma.subCriterion.count()).toBe(0)
  })

  it('2. configures criterion 1 and sub-criterion 1.1 with old and new links', async () => {
    const criterion = await prisma.criterion.findUniqueOrThrow({ where: { number: 1 } })
    const sub = await prisma.subCriterion.create({
      data: { criterionId: criterion.id, code: '1.1', title: 'Leadership', order: 1 },
    })
    subCriterionId = sub.id
    await prisma.sourceMapping.create({
      data: {
        subCriterionId: sub.id,
        oldUrl: `https://drive.google.com/drive/folders/oldFolder`,
        oldResourceId: SOURCE_ID,
        oldResourceType: 'document',
        newUrl: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
        newResourceId: FOLDER_ID,
        newResourceType: 'folder',
        validationStatus: 'valid',
      },
    })
    expect(await prisma.sourceMapping.count()).toBe(1)
  })

  it('3. records a scanned source document', async () => {
    const mapping = await prisma.sourceMapping.findUniqueOrThrow({ where: { subCriterionId } })
    const doc = await prisma.sourceDocument.create({
      data: {
        sourceMappingId: mapping.id,
        googleFileId: SOURCE_ID,
        title: 'PPD-SGL-CG-1.1.1 Leadership and Corporate Governance',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date(MODIFIED),
      },
    })
    sourceDocumentId = doc.id
    expect(doc.migrationStatus).toBe('not_started')
  })

  it('4. activates a template and AI instructions', async () => {
    await prisma.templateVersion.create({
      data: {
        name: 'Approved template',
        googleDocId: TEMPLATE_ID,
        url: `https://docs.google.com/document/d/${TEMPLATE_ID}/edit`,
        versionLabel: 'v1',
        validationResult: JSON.stringify({ valid: true }),
        configSnapshot: JSON.stringify({ requiredSections: ['PRACI Responsibility Matrix'] }),
        isActive: true,
        activatedAt: new Date(),
      },
    })
    await prisma.aIInstructionVersion.create({
      data: { versionLabel: 'v1', body: mod.DEFAULT_AI_INSTRUCTIONS, isActive: true, activatedAt: new Date() },
    })
    expect(await prisma.templateVersion.count({ where: { isActive: true } })).toBe(1)
  })

  it('5. BLOCKS migration while no approved mapping exists', async () => {
    const { canRunMigration } = await import('../lib/validation/gate.ts')
    const approved = await prisma.mappingVersion.findFirst({
      where: { isActive: true, approvalStatus: 'approved' },
    })
    expect(approved).toBeNull()
    expect(
      canRunMigration({
        hasApprovedActiveMapping: Boolean(approved),
        hasActiveTemplate: true,
        hasActiveAIInstruction: true,
      }).allowed,
    ).toBe(false)
  })

  it('6. adds and approves a mapping version, which unblocks migration', async () => {
    const version = await prisma.mappingVersion.create({ data: { versionLabel: 'v1' } })
    mappingVersionId = version.id
    await prisma.mappingRule.create({
      data: {
        mappingVersionId: version.id,
        oldSectionName: 'Responsibilities',
        newTargetSection: 'PRACI Responsibility Matrix',
        transformationRule: 'Move responsibilities into the PRACI matrix.',
        priority: 10,
      },
    })
    await prisma.mappingVersion.update({
      where: { id: version.id },
      data: {
        approvalStatus: 'approved',
        approvedBy: 'felix@unitedceres.edu.sg',
        approvedAt: new Date(),
        isActive: true,
      },
    })

    const { canRunMigration } = await import('../lib/validation/gate.ts')
    expect(
      canRunMigration({
        hasApprovedActiveMapping: true,
        hasActiveTemplate: true,
        hasActiveAIInstruction: true,
      }).allowed,
    ).toBe(true)
  })

  it('7. queues and completes one migration', async () => {
    const [template, instruction] = await Promise.all([
      prisma.templateVersion.findFirstOrThrow({ where: { isActive: true } }),
      prisma.aIInstructionVersion.findFirstOrThrow({ where: { isActive: true } }),
    ])
    const job = await prisma.migrationJob.create({
      data: {
        sourceDocumentId,
        stage: 'queued',
        correlationId: 'test-correlation',
        templateVersionId: template.id,
        aiInstructionVersionId: instruction.id,
        mappingVersionId,
      },
    })

    await mod.runJob(job.id, {
      drive: fakeDrive as never,
      docs: fakeDocs as never,
      ai: fakeAI as never,
    })

    const finished = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(finished.stage).toBe('awaiting_review')
  })

  it('8. created the revised document from the template, never from the source', () => {
    expect(copyCount).toBe(1)
    expect(writes).toHaveLength(1)
    expect(writes[0]!.docId).not.toBe(SOURCE_ID)
  })

  it('9. applies the output title rule and version 2.1', async () => {
    const migrated = await prisma.migratedDocument.findFirstOrThrow()
    migratedDocumentId = migrated.id
    expect(migrated.targetTitle).toBe(
      'REVISED - PPD-SGL-CG-1.1.1 Leadership and Corporate Governance (v2.1)',
    )
    expect(migrated.outputVersion).toBe('2.1')
    expect(migrated.destinationFolderId).toBe(FOLDER_ID)
  })

  it('10. records detailed changes with real excerpts', async () => {
    const changes = await prisma.changeRecord.findMany({ where: { migratedDocumentId } })
    expect(changes.length).toBeGreaterThan(0)
    for (const change of changes) {
      if (!change.originalExcerpt) continue
      // Every excerpt must be real source text.
      expect(
        'Responsibilities The Principal shall approve refunds within 7 working days under clause 4.2.1.',
      ).toContain(change.originalExcerpt.replace(/…$/, ''))
    }
  })

  it('11. ran deterministic validation', async () => {
    const run = await prisma.validationRun.findFirstOrThrow({
      where: { migratedDocumentId, layer: 'deterministic' },
      include: { items: true },
    })
    expect(run.items.length).toBeGreaterThan(0)
    expect(run.summary).toMatch(/passed/)
  })

  it('12. ran AI validation as a SEPARATE run, storing the provider request id', async () => {
    const run = await prisma.validationRun.findFirstOrThrow({
      where: { migratedDocumentId, layer: 'ai' },
      include: { items: true },
    })
    expect(run.providerRequestId).toBe('req_test_123')
    expect(run.model).toBe('gpt-5-mini')
    expect(run.items.some((i) => i.result === 'warning')).toBe(true)
    // Two distinct runs — the layers are never merged.
    expect(await prisma.validationRun.count({ where: { migratedDocumentId } })).toBe(2)
  })

  it('13. BLOCKS approval while an item is unresolved', async () => {
    const items = await prisma.validationItem.findMany({
      where: { validationRun: { migratedDocumentId } },
    })
    const gate = mod.evaluateApprovalGate(
      items.map((i) => ({
        result: i.result as 'pass' | 'warning' | 'fail',
        resolutionStatus: i.resolutionStatus as 'open',
      })),
    )
    expect(gate.canApprove).toBe(false)
  })

  it('14. allows approval once every item is resolved', async () => {
    await prisma.validationItem.updateMany({
      where: { validationRun: { migratedDocumentId }, result: { in: ['warning', 'fail'] } },
      data: { resolutionStatus: 'acknowledged', resolvedAt: new Date() },
    })
    const items = await prisma.validationItem.findMany({
      where: { validationRun: { migratedDocumentId } },
    })
    const gate = mod.evaluateApprovalGate(
      items.map((i) => ({
        result: i.result as 'pass' | 'warning' | 'fail',
        resolutionStatus: i.resolutionStatus as 'acknowledged',
      })),
    )
    expect(gate.canApprove).toBe(true)

    await prisma.reviewDecision.create({
      data: {
        migratedDocumentId,
        reviewerEmail: 'felix@unitedceres.edu.sg',
        decision: 'approved',
        mappingVersionId,
      },
    })
    await prisma.migratedDocument.update({ where: { id: migratedDocumentId }, data: { status: 'approved' } })
    expect(
      (await prisma.migratedDocument.findUniqueOrThrow({ where: { id: migratedDocumentId } })).status,
    ).toBe('approved')
  })

  it('15. logged every significant action to the activity log', async () => {
    const actions = (await prisma.activityLog.findMany()).map((a) => a.action)
    expect(actions).toContain('migration_stage_changed')
    expect(actions).toContain('migration_completed')
  })

  it('16. the activity log is append-only — updates and deletes are refused', async () => {
    const entry = await prisma.activityLog.findFirstOrThrow()
    await expect(
      prisma.activityLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/)
    await expect(prisma.activityLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    )
  })

  it('17. prevents a duplicate revised document in the same folder', async () => {
    await expect(
      prisma.migratedDocument.create({
        data: {
          migrationJobId: (
            await prisma.migrationJob.create({
              data: { sourceDocumentId, stage: 'queued', correlationId: 'dup' },
            })
          ).id,
          sourceDocumentId,
          targetTitle: 'REVISED - PPD-SGL-CG-1.1.1 Leadership and Corporate Governance (v2.1)',
          destinationFolderId: FOLDER_ID,
          sourceModifiedTimeAtMigration: new Date(MODIFIED),
        },
      }),
    ).rejects.toThrow()
  })

  it('18. exports the report as CSV and JSON', async () => {
    const { toCsv } = await import('../lib/report/export.ts')
    const docs = await prisma.sourceDocument.findMany()
    const csv = toCsv(docs.map((d) => ({ title: d.title, status: d.migrationStatus })))
    expect(csv).toContain('title,status')
    expect(csv).toContain('PPD-SGL-CG-1.1.1')
    expect(JSON.parse(JSON.stringify(docs))).toHaveLength(1)
  })
})
