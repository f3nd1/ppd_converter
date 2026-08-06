import { Router } from 'express'
import { z } from 'zod'
import { recordActivity, toDisplayTimestamps } from '../lib/activity.ts'
import { prisma } from '../lib/db.ts'
import { handler, HttpError , param } from '../lib/http.ts'
import { toCsv, toPrintableHtml } from '../lib/report/export.ts'

export const reportsRouter = Router()

// --- Dashboard -------------------------------------------------------------

reportsRouter.get(
  '/dashboard',
  handler(async (_req, res) => {
    // Every figure is counted live. Nothing here is hardcoded.
    const [
      totalSourceDocuments,
      criteriaCount,
      subCriteriaCount,
      statusRows,
      validationIssues,
      template,
      instruction,
      mapping,
      recentActivity,
    ] = await Promise.all([
      prisma.sourceDocument.count(),
      prisma.criterion.count(),
      prisma.subCriterion.count({ where: { isActive: true } }),
      prisma.sourceDocument.groupBy({ by: ['migrationStatus'], _count: { _all: true } }),
      prisma.validationItem.count({ where: { result: { in: ['warning', 'fail'] }, resolutionStatus: 'open' } }),
      prisma.templateVersion.findFirst({ where: { isActive: true } }),
      prisma.aIInstructionVersion.findFirst({ where: { isActive: true } }),
      prisma.mappingVersion.findFirst({ where: { isActive: true, approvalStatus: 'approved' } }),
      prisma.activityLog.findMany({ orderBy: { occurredAtUtc: 'desc' }, take: 15 }),
    ])

    const byStatus = Object.fromEntries(
      statusRows.map((r) => [r.migrationStatus, r._count._all]),
    ) as Record<string, number>

    const processingStages = ['reading_source', 'parsing_structure', 'mapping_content', 'generating_content', 'copying_template', 'writing_target', 'validating']
    const processing = await prisma.migrationJob.count({ where: { stage: { in: processingStages } } })

    const migrated = (byStatus.awaiting_review ?? 0) + (byStatus.approved ?? 0) + (byStatus.exported ?? 0)
    const progress = totalSourceDocuments === 0 ? 0 : Math.round((migrated / totalSourceDocuments) * 100)

    res.json({
      totals: {
        sourceDocuments: totalSourceDocuments,
        criteria: criteriaCount,
        subCriteria: subCriteriaCount,
      },
      status: {
        notStarted: byStatus.not_started ?? 0,
        queued: byStatus.queued ?? 0,
        processing,
        migrated,
        awaitingReview: byStatus.awaiting_review ?? 0,
        approved: byStatus.approved ?? 0,
        failed: byStatus.failed ?? 0,
      },
      validationIssues,
      progressPercent: progress,
      activeTemplate: template
        ? { id: template.id, name: template.name, versionLabel: template.versionLabel, url: template.url }
        : null,
      activeAIInstruction: instruction
        ? { id: instruction.id, versionLabel: instruction.versionLabel }
        : null,
      activeMapping: mapping
        ? { id: mapping.id, versionLabel: mapping.versionLabel, approvalStatus: mapping.approvalStatus }
        : null,
      recentActivity: recentActivity.map((a) => ({
        ...a,
        ...toDisplayTimestamps(a.occurredAtUtc),
      })),
    })
  }),
)

// --- Activity log ----------------------------------------------------------

reportsRouter.get(
  '/activity',
  handler(async (req, res) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100), action: z.string().optional() })
      .parse(req.query)

    const entries = await prisma.activityLog.findMany({
      where: query.action ? { action: query.action } : undefined,
      orderBy: { occurredAtUtc: 'desc' },
      take: query.limit,
    })
    res.json({
      entries: entries.map((e) => ({ ...e, ...toDisplayTimestamps(e.occurredAtUtc) })),
    })
  }),
)

// --- Migration report ------------------------------------------------------

async function buildMigrationReport() {
  const [documents, migrated, validationItems, criteria] = await Promise.all([
    prisma.sourceDocument.findMany({
      include: { sourceMapping: { include: { subCriterion: { include: { criterion: true } } } } },
    }),
    prisma.migratedDocument.findMany({ include: { migrationJob: true } }),
    prisma.validationItem.findMany(),
    prisma.criterion.findMany({ orderBy: { order: 'asc' } }),
  ])

  const statusCounts = documents.reduce<Record<string, number>>((acc, d) => {
    acc[d.migrationStatus] = (acc[d.migrationStatus] ?? 0) + 1
    return acc
  }, {})

  const byCriterion = criteria.map((c) => {
    const docs = documents.filter((d) => d.sourceMapping.subCriterion.criterionId === c.id)
    const done = docs.filter((d) => ['approved', 'exported'].includes(d.migrationStatus)).length
    return {
      criterion: `Criterion ${c.number}`,
      documents: docs.length,
      approved: done,
      completeness: docs.length ? Math.round((done / docs.length) * 100) : 0,
    }
  })

  const bySubCriterion = documents.reduce<Record<string, { subCriterion: string; documents: number; approved: number }>>(
    (acc, d) => {
      const sub = d.sourceMapping.subCriterion
      const key = `${sub.code} ${sub.title}`
      acc[key] ??= { subCriterion: key, documents: 0, approved: 0 }
      acc[key].documents += 1
      if (['approved', 'exported'].includes(d.migrationStatus)) acc[key].approved += 1
      return acc
    },
    {},
  )

  const startTimes = migrated.map((m) => m.migrationJob.startedAt).filter(Boolean) as Date[]
  const endTimes = migrated.map((m) => m.migrationJob.finishedAt).filter(Boolean) as Date[]
  const approvedCount = documents.filter((d) => ['approved', 'exported'].includes(d.migrationStatus)).length

  return {
    totalDocuments: documents.length,
    statusCounts,
    byCriterion,
    bySubCriterion: Object.values(bySubCriterion),
    completenessPercent: documents.length ? Math.round((approvedCount / documents.length) * 100) : 0,
    validationWarnings: validationItems.filter((i) => i.result === 'warning').length,
    validationFailures: validationItems.filter((i) => i.result === 'fail').length,
    approvedCount,
    failedCount: statusCounts.failed ?? 0,
    startedAt: startTimes.length ? new Date(Math.min(...startTimes.map((d) => d.getTime()))) : null,
    completedAt: endTimes.length ? new Date(Math.max(...endTimes.map((d) => d.getTime()))) : null,
  }
}

reportsRouter.get(
  '/reports/migration',
  handler(async (_req, res) => res.json(await buildMigrationReport())),
)

reportsRouter.get(
  '/reports/document/:id',
  handler(async (req, res) => {
    const doc = await prisma.migratedDocument.findUnique({
      where: { id: param(req, 'id') },
      include: {
        sourceDocument: {
          include: { sourceMapping: { include: { subCriterion: { include: { criterion: true } } } } },
        },
        changes: { orderBy: { changeNumber: 'asc' } },
        validationRuns: { include: { items: true } },
        reviewDecisions: { orderBy: { decidedAt: 'desc' } },
        migrationJob: {
          include: { aiInstructionVersion: true, mappingVersion: true, templateVersion: true },
        },
      },
    })
    if (!doc) throw new HttpError(404, 'That document does not exist.')
    res.json({ document: doc })
  }),
)

// --- Exports ---------------------------------------------------------------

reportsRouter.get(
  '/reports/export',
  handler(async (req, res) => {
    const query = z
      .object({ format: z.enum(['csv', 'json', 'html']), scope: z.enum(['migration', 'activity']).default('migration') })
      .parse(req.query)

    const stamp = new Date().toISOString().slice(0, 10)
    let rowCount = 0

    if (query.scope === 'activity') {
      const entries = await prisma.activityLog.findMany({ orderBy: { occurredAtUtc: 'desc' }, take: 5000 })
      rowCount = entries.length
      const rows = entries.map((e) => ({
        utc: e.occurredAtUtc.toISOString(),
        singapore: toDisplayTimestamps(e.occurredAtUtc).singapore,
        action: e.action,
        entityType: e.entityType ?? '',
        entityId: e.entityId ?? '',
        result: e.result,
        summary: e.summary ?? '',
        errorRef: e.errorRef ?? '',
      }))
      send(res, query.format, `ppd-activity-${stamp}`, rows, {
        title: 'PPD Converter — Activity Log',
        sections: [{ heading: `Activity (${rows.length})`, rows }],
      })
    } else {
      const report = await buildMigrationReport()
      const documents = await prisma.sourceDocument.findMany({
        include: {
          sourceMapping: { include: { subCriterion: { include: { criterion: true } } } },
          migratedDocuments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })
      rowCount = documents.length
      const rows = documents.map((d) => ({
        criterion: `Criterion ${d.sourceMapping.subCriterion.criterion.number}`,
        subCriterion: `${d.sourceMapping.subCriterion.code} ${d.sourceMapping.subCriterion.title}`,
        sourceTitle: d.title,
        sourceLink: d.webViewLink ?? '',
        targetTitle: d.migratedDocuments[0]?.targetTitle ?? '',
        targetLink: d.migratedDocuments[0]?.targetUrl ?? '',
        outputVersion: d.migratedDocuments[0]?.outputVersion ?? '',
        status: d.migrationStatus,
      }))

      if (query.format === 'json') {
        send(res, 'json', `ppd-migration-${stamp}`, rows, { title: '', sections: [] }, { report, documents: rows })
      } else {
        send(res, query.format, `ppd-migration-${stamp}`, rows, {
          title: 'PPD Converter — Migration Report',
          subtitle: `${report.totalDocuments} document(s) · ${report.completenessPercent}% complete · ${report.validationFailures} failure(s), ${report.validationWarnings} warning(s)`,
          sections: [
            { heading: 'By criterion', rows: report.byCriterion },
            { heading: 'By sub-criterion', rows: report.bySubCriterion },
            { heading: 'Documents', rows },
          ],
        })
      }
    }

    await prisma.exportRecord.create({
      data: { format: query.format, scope: query.scope, rowCount, correlationId: req.correlationId },
    })
    await recordActivity({
      action: 'report_export',
      entityType: 'ExportRecord',
      summary: `Exported ${query.scope} as ${query.format.toUpperCase()} (${rowCount} row(s)).`,
      correlationId: req.correlationId,
    })
  }),
)

function send(
  res: import('express').Response,
  format: 'csv' | 'json' | 'html',
  filename: string,
  rows: Record<string, unknown>[],
  html: { title: string; subtitle?: string; sections: { heading: string; rows?: Record<string, unknown>[] }[] },
  jsonPayload?: unknown,
) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
    res.send(toCsv(rows))
    return
  }
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`)
    res.send(JSON.stringify(jsonPayload ?? rows, null, 2))
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(toPrintableHtml({ ...html, generatedAt: new Date() }))
}
