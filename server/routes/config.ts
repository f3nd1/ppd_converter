import { Router } from 'express'
import { z } from 'zod'
import { recordActivity } from '../lib/activity.ts'
import { prisma } from '../lib/db.ts'
import { DriveError } from '../lib/google/drive.ts'
import { googleClients } from '../lib/google/session-client.ts'
import { DOCUMENT_MIME, parseGoogleUrl, resourceTypeFromMime } from '../lib/google/urls.ts'
import { handler, HttpError, parseBody, rateLimit , param } from '../lib/http.ts'
import { placeholderFor } from '../lib/doc/generate.ts'

export const configRouter = Router()

// Template, AI instructions and section mapping. All three are versioned, and
// exactly one of each may be active.

// --- Template --------------------------------------------------------------

// The target structure is CONFIGURABLE, not hardcoded — the approved template is
// still being finalised. These are the sections currently expected; the real set
// is whatever the operator saves, and is frozen into each template version's
// configSnapshot at activation.
export const DEFAULT_TARGET_SECTIONS = [
  'Policy and Approach',
  'Continuous System Evaluation',
  'PRACI Responsibility Matrix',
  'Procedure',
  'GD4 Cross-reference Mapping',
]

const templateInput = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200).default('Approved PPD template'),
  versionLabel: z.string().trim().min(1).max(50).default('v1'),
  requiredSections: z.array(z.string().trim().min(1)).default(DEFAULT_TARGET_SECTIONS),
})

configRouter.post(
  '/template/validate',
  rateLimit('template_validate', 20, 60_000),
  handler(async (req, res) => {
    const input = parseBody(templateInput, req.body)

    // The production template is a Google Docs URL. File upload is deliberately
    // not offered — the brief requires the live template to be a Doc.
    const parsed = parseGoogleUrl(input.url)
    if (!parsed.ok) throw new HttpError(400, parsed.reason)

    const { drive, docs } = await googleClients()
    const problems: string[] = []
    let doc = null

    try {
      const file = await drive.getFile(parsed.value.resourceId)
      const type = resourceTypeFromMime(file.mimeType)
      if (type === 'folder') problems.push('That link is a folder, not a Google Doc.')
      else if (file.mimeType !== DOCUMENT_MIME) {
        problems.push(`That link is a "${file.mimeType}", not a Google Doc.`)
      } else {
        doc = await docs.getDocument(parsed.value.resourceId)
      }
    } catch (err) {
      const status = err instanceof DriveError ? err.status : undefined
      problems.push(
        status === 404
          ? 'The authorised account cannot access that document.'
          : `The document could not be read: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // It must not be a source or a destination — copying a template that is
    // itself a source document would put a migration in a loop.
    const clash = await prisma.sourceDocument.findFirst({
      where: { googleFileId: parsed.value.resourceId },
    })
    if (clash) problems.push('That document is a scanned source document, so it cannot be the template.')

    const asDestination = await prisma.sourceMapping.findFirst({
      where: { newResourceId: parsed.value.resourceId },
    })
    if (asDestination) problems.push('That resource is configured as a destination folder.')

    // Structural check: the placeholders the generator writes into must exist,
    // otherwise migration would silently produce an empty document.
    const missingPlaceholders: string[] = []
    if (doc) {
      const bodyText = JSON.stringify(doc.body ?? {})
      for (const section of input.requiredSections) {
        if (!bodyText.includes(placeholderFor(section))) missingPlaceholders.push(section)
      }
      if (missingPlaceholders.length) {
        problems.push(
          `The template is missing a placeholder for: ${missingPlaceholders
            .map((s) => `${s} (${placeholderFor(s)})`)
            .join(', ')}.`,
        )
      }
      if (!doc.headers || Object.keys(doc.headers).length === 0) {
        problems.push('The template has no header. Headers, footers and page numbering come from the template.')
      }
      if (!doc.footers || Object.keys(doc.footers).length === 0) {
        problems.push('The template has no footer.')
      }
    }

    const valid = problems.length === 0
    const result = {
      valid,
      problems,
      googleDocId: parsed.value.resourceId,
      title: doc?.title ?? null,
      requiredSections: input.requiredSections,
      missingPlaceholders,
      checkedAt: new Date().toISOString(),
    }

    await recordActivity({
      action: 'template_validation',
      entityType: 'TemplateVersion',
      entityId: parsed.value.resourceId,
      result: valid ? 'success' : 'failure',
      summary: valid ? 'Template validated.' : problems.join(' ').slice(0, 400),
      correlationId: req.correlationId,
    })

    res.json(result)
  }),
)

configRouter.post(
  '/template/activate',
  handler(async (req, res) => {
    const input = parseBody(
      templateInput.extend({ validationResult: z.record(z.string(), z.unknown()) }),
      req.body,
    )
    if (input.validationResult.valid !== true) {
      throw new HttpError(400, 'The template must pass validation before it can be activated.')
    }
    const parsed = parseGoogleUrl(input.url)
    if (!parsed.ok) throw new HttpError(400, parsed.reason)

    // Only one template may be active.
    const created = await prisma.$transaction(async (tx) => {
      await tx.templateVersion.updateMany({ where: { isActive: true }, data: { isActive: false } })
      return tx.templateVersion.create({
        data: {
          name: input.name,
          googleDocId: parsed.value.resourceId,
          url: input.url,
          versionLabel: input.versionLabel,
          validationResult: JSON.stringify(input.validationResult),
          configSnapshot: JSON.stringify({ requiredSections: input.requiredSections }),
          isActive: true,
          activatedAt: new Date(),
        },
      })
    })

    await recordActivity({
      action: 'template_activation',
      entityType: 'TemplateVersion',
      entityId: created.id,
      summary: `Activated template "${created.name}" ${created.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ template: created })
  }),
)

configRouter.get(
  '/template/versions',
  handler(async (_req, res) => {
    const versions = await prisma.templateVersion.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ versions, defaultTargetSections: DEFAULT_TARGET_SECTIONS })
  }),
)

// --- AI instructions -------------------------------------------------------

configRouter.get(
  '/ai-instructions',
  handler(async (_req, res) => {
    const versions = await prisma.aIInstructionVersion.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ versions })
  }),
)

configRouter.post(
  '/ai-instructions',
  handler(async (req, res) => {
    const input = parseBody(
      z.object({
        versionLabel: z.string().trim().min(1).max(50),
        body: z.string().trim().min(1),
        restoredFromId: z.string().optional(),
      }),
      req.body,
    )
    const created = await prisma.aIInstructionVersion.create({ data: input })
    await recordActivity({
      action: 'ai_instruction_changed',
      entityType: 'AIInstructionVersion',
      entityId: created.id,
      summary: `Saved AI instruction ${created.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ version: created })
  }),
)

configRouter.post(
  '/ai-instructions/:id/activate',
  handler(async (req, res) => {
    const target = await prisma.aIInstructionVersion.findUnique({ where: { id: param(req, 'id') } })
    if (!target) throw new HttpError(404, 'That instruction version does not exist.')

    const activated = await prisma.$transaction(async (tx) => {
      await tx.aIInstructionVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      })
      return tx.aIInstructionVersion.update({
        where: { id: param(req, 'id') },
        data: { isActive: true, activatedAt: new Date() },
      })
    })

    await recordActivity({
      action: 'ai_instruction_changed',
      entityType: 'AIInstructionVersion',
      entityId: activated.id,
      summary: `Activated AI instruction ${activated.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.json({ version: activated })
  }),
)

/** Restore copies an old version forward as a new one — history is never rewritten. */
configRouter.post(
  '/ai-instructions/:id/restore',
  handler(async (req, res) => {
    const source = await prisma.aIInstructionVersion.findUnique({ where: { id: param(req, 'id') } })
    if (!source) throw new HttpError(404, 'That instruction version does not exist.')

    const count = await prisma.aIInstructionVersion.count()
    const created = await prisma.aIInstructionVersion.create({
      data: {
        versionLabel: `v${count + 1} (restored from ${source.versionLabel})`,
        body: source.body,
        restoredFromId: source.id,
      },
    })
    await recordActivity({
      action: 'ai_instruction_changed',
      entityType: 'AIInstructionVersion',
      entityId: created.id,
      summary: `Restored ${source.versionLabel} as ${created.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ version: created })
  }),
)

// --- Section mapping -------------------------------------------------------

configRouter.get(
  '/mapping-versions',
  handler(async (_req, res) => {
    const versions = await prisma.mappingVersion.findMany({
      orderBy: { createdAt: 'desc' },
      include: { rules: { orderBy: { priority: 'asc' } } },
    })
    res.json({ versions })
  }),
)

configRouter.post(
  '/mapping-versions',
  handler(async (req, res) => {
    const input = parseBody(
      z.object({
        versionLabel: z.string().trim().min(1).max(50),
        notes: z.string().trim().max(2000).optional(),
      }),
      req.body,
    )
    const created = await prisma.mappingVersion.create({ data: input })
    await recordActivity({
      action: 'mapping_changed',
      entityType: 'MappingVersion',
      entityId: created.id,
      summary: `Created mapping version ${created.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ version: created })
  }),
)

configRouter.post(
  '/mapping-versions/:id/approve',
  handler(async (req, res) => {
    const version = await prisma.mappingVersion.findUnique({
      where: { id: param(req, 'id') },
      include: { rules: true },
    })
    if (!version) throw new HttpError(404, 'That mapping version does not exist.')
    // An approved mapping with no rules would unblock migration while mapping
    // nothing — the exact "approved but empty" trap worth refusing outright.
    if (version.rules.filter((r) => r.isActive).length === 0) {
      throw new HttpError(400, 'A mapping version needs at least one active rule before approval.')
    }

    const approved = await prisma.mappingVersion.update({
      where: { id: param(req, 'id') },
      data: {
        approvalStatus: 'approved',
        approvedBy: req.session?.email ?? 'unknown',
        approvedAt: new Date(),
      },
    })
    await recordActivity({
      action: 'mapping_changed',
      entityType: 'MappingVersion',
      entityId: approved.id,
      summary: `Approved mapping version ${approved.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.json({ version: approved })
  }),
)

configRouter.post(
  '/mapping-versions/:id/activate',
  handler(async (req, res) => {
    const version = await prisma.mappingVersion.findUnique({ where: { id: param(req, 'id') } })
    if (!version) throw new HttpError(404, 'That mapping version does not exist.')
    if (version.approvalStatus !== 'approved') {
      throw new HttpError(400, 'Only an approved mapping version can be activated.')
    }

    const activated = await prisma.$transaction(async (tx) => {
      await tx.mappingVersion.updateMany({ where: { isActive: true }, data: { isActive: false } })
      return tx.mappingVersion.update({ where: { id: param(req, 'id') }, data: { isActive: true } })
    })

    await recordActivity({
      action: 'mapping_changed',
      entityType: 'MappingVersion',
      entityId: activated.id,
      summary: `Activated mapping version ${activated.versionLabel}`,
      correlationId: req.correlationId,
    })
    res.json({ version: activated })
  }),
)

const ruleInput = z.object({
  mappingVersionId: z.string().min(1),
  oldSectionName: z.string().trim().min(1).max(300),
  newTargetSection: z.string().trim().min(1).max(300),
  transformationRule: z.string().trim().min(1).max(2000),
  priority: z.number().int().min(1).max(9999).default(100),
  notes: z.string().trim().max(2000).optional(),
})

configRouter.post(
  '/mapping-rules',
  handler(async (req, res) => {
    const input = parseBody(ruleInput, req.body)
    const version = await prisma.mappingVersion.findUnique({
      where: { id: input.mappingVersionId },
    })
    if (!version) throw new HttpError(404, 'That mapping version does not exist.')
    // Editing an approved version would change what was approved. Approval has
    // to mean something, so the version is knocked back to draft instead.
    if (version.approvalStatus === 'approved') {
      throw new HttpError(
        409,
        'This mapping version is approved and cannot be edited. Create a new version instead.',
      )
    }

    const created = await prisma.mappingRule.create({ data: input })
    await recordActivity({
      action: 'mapping_changed',
      entityType: 'MappingRule',
      entityId: created.id,
      summary: `Added rule "${created.oldSectionName}" → "${created.newTargetSection}"`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ rule: created })
  }),
)

configRouter.delete(
  '/mapping-rules/:id',
  handler(async (req, res) => {
    const rule = await prisma.mappingRule.findUnique({
      where: { id: param(req, 'id') },
      include: { mappingVersion: true },
    })
    if (!rule) throw new HttpError(404, 'That rule does not exist.')
    if (rule.mappingVersion.approvalStatus === 'approved') {
      throw new HttpError(409, 'This mapping version is approved and cannot be edited.')
    }
    await prisma.mappingRule.delete({ where: { id: param(req, 'id') } })
    await recordActivity({
      action: 'mapping_changed',
      entityType: 'MappingRule',
      entityId: param(req, 'id'),
      summary: 'Deleted a mapping rule.',
      correlationId: req.correlationId,
    })
    res.json({ ok: true })
  }),
)
