import type { RewriteOutput } from '../ai/schemas.ts'
import type { z } from 'zod'
import type { ProposedChange as ProposedChangeSchema } from '../ai/schemas.ts'
import type { DocBlock } from '../doc/model.ts'
import { normaliseText } from '../doc/model.ts'
import type { ChangeType } from '../enums.ts'
import type { BlockMapping } from './mapping.ts'
import type { SectionContent } from '../doc/generate.ts'

// The change record.
//
// The single most important rule here: EXCERPTS ARE NEVER FABRICATED. The AI
// proposes what changed and why, but every excerpt is SLICED from real stored
// content — the source block text, or the generated target section text. The AI
// never authors an excerpt, so a hallucinated quote cannot reach the record.
// changes.test.ts asserts exactly this.

const EXCERPT_LIMIT = 500

export type BuiltChange = {
  changeNumber: number
  changeType: ChangeType
  sourceSection: string | null
  targetSection: string | null
  sourceBlockId: string | null
  originalExcerpt: string | null
  revisedExcerpt: string | null
  reason: string
  confidence: number | null
}

function excerpt(text: string): string {
  const clean = normaliseText(text)
  return clean.length <= EXCERPT_LIMIT ? clean : `${clean.slice(0, EXCERPT_LIMIT)}…`
}

/**
 * Finds the part of the target section that corresponds to a source block.
 * Falls back to the section opening rather than inventing something: an excerpt
 * that is merely imprecise is recoverable, one that is fictional is not.
 */
function revisedExcerptFor(block: DocBlock | undefined, section: SectionContent | undefined) {
  if (!section) return null
  if (block) {
    const needle = normaliseText(block.text).slice(0, 40)
    const idx = needle ? normaliseText(section.content).indexOf(needle) : -1
    if (idx >= 0) return excerpt(normaliseText(section.content).slice(idx))
  }
  return excerpt(section.content)
}

export function buildChangeRecords(args: {
  rewrite: RewriteOutput
  blocks: DocBlock[]
  mappings: BlockMapping[]
  sections: SectionContent[]
}): BuiltChange[] {
  const blockById = new Map(args.blocks.map((b) => [b.blockId, b]))
  const sectionByName = new Map(args.sections.map((s) => [s.name, s]))
  const mappingByBlock = new Map(args.mappings.map((m) => [m.blockId, m]))

  const built: BuiltChange[] = []
  let n = 1

  const add = (change: z.infer<typeof ProposedChangeSchema>) => {
    const block = change.sourceBlockId ? blockById.get(change.sourceBlockId) : undefined
    const section = change.targetSection ? sectionByName.get(change.targetSection) : undefined
    built.push({
      changeNumber: n++,
      changeType: change.changeType,
      sourceSection: change.sourceSection,
      targetSection: change.targetSection,
      sourceBlockId: change.sourceBlockId,
      // Sliced from the stored source block — not from the model's output.
      originalExcerpt: block ? excerpt(block.text) : null,
      revisedExcerpt: revisedExcerptFor(block, section),
      reason: change.reason,
      confidence: change.confidence,
    })
  }

  for (const change of args.rewrite.changes) add(change)

  // Anything the model did not report a change for still has to be accounted
  // for — silence is not the same as "nothing happened".
  const reported = new Set(args.rewrite.changes.map((c) => c.sourceBlockId).filter(Boolean))
  for (const block of args.blocks) {
    if (reported.has(block.blockId)) continue
    const mapping = mappingByBlock.get(block.blockId)
    const unmapped = !mapping || mapping.status === 'unmapped'
    built.push({
      changeNumber: n++,
      changeType: unmapped ? 'content_unmapped' : 'content_unchanged',
      sourceSection: null,
      targetSection: mapping?.targetSection ?? null,
      sourceBlockId: block.blockId,
      originalExcerpt: excerpt(block.text),
      revisedExcerpt: unmapped
        ? null
        : revisedExcerptFor(
            block,
            mapping?.targetSection ? sectionByName.get(mapping.targetSection) : undefined,
          ),
      reason: unmapped
        ? 'No approved mapping rule covers this content, so it was not migrated.'
        : 'Carried across without modification.',
      confidence: null,
    })
  }

  return built
}
