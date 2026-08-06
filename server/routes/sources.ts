import { Router } from 'express'
import { z } from 'zod'
import { recordActivity } from '../lib/activity.ts'
import { prisma } from '../lib/db.ts'
import { DriveError } from '../lib/google/drive.ts'
import { googleClients } from '../lib/google/session-client.ts'
import { parseGoogleUrl, resourceTypeFromMime } from '../lib/google/urls.ts'
import { handler, HttpError, parseBody, rateLimit , param } from '../lib/http.ts'

export const sourcesRouter = Router()

const linksInput = z.object({
  oldUrl: z.string().trim().max(2000).optional(),
  newUrl: z.string().trim().max(2000).optional(),
})

/** Saves the pasted links and extracts resource IDs. No network call. */
sourcesRouter.patch(
  '/source-mappings/:subCriterionId/links',
  handler(async (req, res) => {
    const input = parseBody(linksInput, req.body)

    const parse = (url?: string) => {
      if (!url) return { url: null, id: null, error: null as string | null }
      const parsed = parseGoogleUrl(url)
      return parsed.ok
        ? { url, id: parsed.value.resourceId, error: null }
        : { url, id: null, error: parsed.reason }
    }

    const oldSide = parse(input.oldUrl)
    const newSide = parse(input.newUrl)
    const errors = [oldSide.error, newSide.error].filter(Boolean)

    const mapping = await prisma.sourceMapping.upsert({
      where: { subCriterionId: param(req, 'subCriterionId') },
      update: {
        oldUrl: oldSide.url,
        oldResourceId: oldSide.id,
        newUrl: newSide.url,
        newResourceId: newSide.id,
        // Saving new links invalidates any previous validation — the old result
        // describes different resources.
        validationStatus: 'not_validated',
        errorDetail: errors.length ? errors.join(' ') : null,
      },
      create: {
        subCriterionId: param(req, 'subCriterionId'),
        oldUrl: oldSide.url,
        oldResourceId: oldSide.id,
        newUrl: newSide.url,
        newResourceId: newSide.id,
        errorDetail: errors.length ? errors.join(' ') : null,
      },
    })

    res.json({ mapping, errors })
  }),
)

/** Confirms both resources exist, are reachable, and are the right TYPE. */
sourcesRouter.post(
  '/source-mappings/:subCriterionId/validate-links',
  rateLimit('validate_links', 30, 60_000),
  handler(async (req, res) => {
    const mapping = await prisma.sourceMapping.findUnique({
      where: { subCriterionId: param(req, 'subCriterionId') },
    })
    if (!mapping) throw new HttpError(404, 'No links have been saved for this sub-criterion.')
    if (!mapping.oldResourceId || !mapping.newResourceId) {
      throw new HttpError(400, 'Both the old and new Google links must be set first.')
    }

    const { drive } = await googleClients()
    const problems: string[] = []
    let oldType: string | null = null
    let newType: string | null = null

    // Type is confirmed against the API, never inferred from the URL shape —
    // a /file/d/ link can point at a folder or a document.
    for (const side of ['old', 'new'] as const) {
      const id = side === 'old' ? mapping.oldResourceId : mapping.newResourceId
      try {
        const file = await drive.getFile(id)
        const type = resourceTypeFromMime(file.mimeType)
        if (side === 'old') oldType = type
        else newType = type

        if (type === 'other') {
          problems.push(
            `The ${side} link points to a "${file.mimeType}", which is neither a Google Drive folder nor a Google Doc.`,
          )
        }
        if (side === 'new' && type !== 'folder') {
          problems.push('The new link must be a Google Drive folder — revised documents are created inside it.')
        }
      } catch (err) {
        const status = err instanceof DriveError ? err.status : undefined
        problems.push(
          status === 404
            ? `The ${side} resource does not exist, or the authorised account cannot see it.`
            : `The ${side} resource could not be read: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    const valid = problems.length === 0
    const updated = await prisma.sourceMapping.update({
      where: { id: mapping.id },
      data: {
        oldResourceType: oldType,
        newResourceType: newType,
        validationStatus: valid ? 'valid' : 'invalid',
        errorDetail: valid ? null : problems.join(' '),
        lastValidatedAt: new Date(),
      },
    })

    await recordActivity({
      action: 'link_validation',
      entityType: 'SourceMapping',
      entityId: mapping.id,
      result: valid ? 'success' : 'failure',
      summary: valid ? 'Both links validated.' : problems.join(' ').slice(0, 400),
      correlationId: req.correlationId,
    })

    res.json({ mapping: updated, valid, problems })
  }),
)

/** Scans the old folder for Google Docs. Read-only — sources are never touched. */
sourcesRouter.post(
  '/source-mappings/:subCriterionId/scan',
  rateLimit('scan', 20, 60_000),
  handler(async (req, res) => {
    const mapping = await prisma.sourceMapping.findUnique({
      where: { subCriterionId: param(req, 'subCriterionId') },
    })
    if (!mapping?.oldResourceId) throw new HttpError(400, 'Set and validate the old link first.')
    if (mapping.validationStatus !== 'valid') {
      throw new HttpError(400, 'Validate the links before scanning.')
    }

    const { drive } = await googleClients()
    const files =
      mapping.oldResourceType === 'folder'
        ? await drive.listDocsInFolder(mapping.oldResourceId, true)
        : [await drive.getFile(mapping.oldResourceId)]

    // Duplicate detection by normalised title. Conservative on purpose: a false
    // "duplicate" that hides a real document would be worse than an extra row,
    // so only an exact title match after whitespace normalisation counts.
    const seen = new Map<string, string>()
    let duplicates = 0

    for (const file of files) {
      const key = file.name.replace(/\s+/g, ' ').trim().toLowerCase()
      const firstId = seen.get(key)
      const isDuplicate = Boolean(firstId && firstId !== file.id)
      if (isDuplicate) duplicates += 1
      if (!firstId) seen.set(key, file.id)

      await prisma.sourceDocument.upsert({
        where: {
          sourceMappingId_googleFileId: { sourceMappingId: mapping.id, googleFileId: file.id },
        },
        update: {
          title: file.name,
          modifiedTime: new Date(file.modifiedTime),
          webViewLink: file.webViewLink ?? null,
          isDuplicateOf: isDuplicate ? (firstId ?? null) : null,
        },
        create: {
          sourceMappingId: mapping.id,
          googleFileId: file.id,
          title: file.name,
          mimeType: file.mimeType,
          modifiedTime: new Date(file.modifiedTime),
          webViewLink: file.webViewLink ?? null,
          isDuplicateOf: isDuplicate ? (firstId ?? null) : null,
        },
      })
    }

    const updated = await prisma.sourceMapping.update({
      where: { id: mapping.id },
      data: { lastScannedAt: new Date(), sourceDocCount: files.length, errorDetail: null },
    })

    await recordActivity({
      action: 'source_scan',
      entityType: 'SourceMapping',
      entityId: mapping.id,
      summary: `Found ${files.length} Google Doc(s)${duplicates ? `, ${duplicates} duplicate title(s)` : ''}.`,
      correlationId: req.correlationId,
    })

    res.json({ mapping: updated, found: files.length, duplicates })
  }),
)

sourcesRouter.get(
  '/source-documents',
  handler(async (req, res) => {
    const query = z
      .object({
        criterionId: z.string().optional(),
        subCriterionId: z.string().optional(),
        status: z.string().optional(),
        title: z.string().optional(),
      })
      .parse(req.query)

    const documents = await prisma.sourceDocument.findMany({
      where: {
        ...(query.status ? { migrationStatus: query.status } : {}),
        ...(query.title ? { title: { contains: query.title } } : {}),
        sourceMapping: {
          ...(query.subCriterionId ? { subCriterionId: query.subCriterionId } : {}),
          ...(query.criterionId
            ? { subCriterion: { criterionId: query.criterionId } }
            : {}),
        },
      },
      include: {
        sourceMapping: { include: { subCriterion: { include: { criterion: true } } } },
        migratedDocuments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { title: 'asc' },
    })

    res.json({ documents })
  }),
)
