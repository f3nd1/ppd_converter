import { Router } from 'express'
import { z } from 'zod'
import { recordActivity } from '../lib/activity.ts'
import { prisma } from '../lib/db.ts'
import { handler, HttpError, parseBody , param } from '../lib/http.ts'

export const criteriaRouter = Router()

// Criteria 1 to 7 are fixed by the brief and are not created or deleted through
// the API — only their sub-criteria change.

criteriaRouter.get(
  '/criteria',
  handler(async (_req, res) => {
    const criteria = await prisma.criterion.findMany({
      orderBy: { order: 'asc' },
      include: {
        subCriteria: {
          orderBy: { order: 'asc' },
          include: {
            sourceMapping: { include: { _count: { select: { documents: true } } } },
          },
        },
      },
    })
    res.json({ criteria })
  }),
)

const subCriterionInput = z.object({
  criterionId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(300),
})

criteriaRouter.post(
  '/sub-criteria',
  handler(async (req, res) => {
    const input = parseBody(subCriterionInput, req.body)

    const criterion = await prisma.criterion.findUnique({ where: { id: input.criterionId } })
    if (!criterion) throw new HttpError(404, 'That criterion does not exist.')

    const clash = await prisma.subCriterion.findFirst({
      where: { criterionId: input.criterionId, code: input.code },
    })
    if (clash) throw new HttpError(409, `Sub-criterion "${input.code}" already exists here.`)

    const last = await prisma.subCriterion.findFirst({
      where: { criterionId: input.criterionId },
      orderBy: { order: 'desc' },
    })

    const created = await prisma.subCriterion.create({
      data: { ...input, order: (last?.order ?? 0) + 1 },
    })
    // The mapping row is created empty alongside so the old → new link fields
    // always exist for the row to render.
    await prisma.sourceMapping.create({ data: { subCriterionId: created.id } })

    await recordActivity({
      action: 'sub_criterion_changed',
      entityType: 'SubCriterion',
      entityId: created.id,
      summary: `Added ${created.code} ${created.title}`,
      correlationId: req.correlationId,
    })
    res.status(201).json({ subCriterion: created })
  }),
)

const patchInput = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  isActive: z.boolean().optional(),
})

criteriaRouter.patch(
  '/sub-criteria/:id',
  handler(async (req, res) => {
    const input = parseBody(patchInput, req.body)
    const existing = await prisma.subCriterion.findUnique({ where: { id: param(req, 'id') } })
    if (!existing) throw new HttpError(404, 'That sub-criterion does not exist.')

    const updated = await prisma.subCriterion.update({
      where: { id: param(req, 'id') },
      data: {
        ...input,
        // Deactivating is reversible and keeps history; nothing is deleted.
        deactivatedAt:
          input.isActive === false ? new Date() : input.isActive === true ? null : undefined,
      },
    })

    await recordActivity({
      action: 'sub_criterion_changed',
      entityType: 'SubCriterion',
      entityId: updated.id,
      summary:
        input.isActive === false
          ? `Deactivated ${updated.code}`
          : input.isActive === true
            ? `Reactivated ${updated.code}`
            : `Edited ${updated.code} ${updated.title}`,
      correlationId: req.correlationId,
    })
    res.json({ subCriterion: updated })
  }),
)

const reorderInput = z.object({
  criterionId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
})

criteriaRouter.post(
  '/sub-criteria/reorder',
  handler(async (req, res) => {
    const input = parseBody(reorderInput, req.body)
    const owned = await prisma.subCriterion.findMany({
      where: { criterionId: input.criterionId },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((s) => s.id))
    if (input.orderedIds.some((id) => !ownedIds.has(id))) {
      throw new HttpError(400, 'The list contains a sub-criterion from a different criterion.')
    }

    await prisma.$transaction(
      input.orderedIds.map((id, index) =>
        prisma.subCriterion.update({ where: { id }, data: { order: index + 1 } }),
      ),
    )

    await recordActivity({
      action: 'sub_criterion_changed',
      entityType: 'Criterion',
      entityId: input.criterionId,
      summary: 'Reordered sub-criteria.',
      correlationId: req.correlationId,
    })
    res.json({ ok: true })
  }),
)
