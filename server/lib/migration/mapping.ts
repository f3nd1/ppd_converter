import type { DocBlock } from '../doc/model.ts'
import { normaliseText } from '../doc/model.ts'

// The mapping engine. Deterministic and rule-driven: it decides which target
// section each source block belongs to using ONLY the approved mapping rules.
// It never invents a mapping — a block that matches no rule comes back
// 'unmapped' and is surfaced to the reviewer.
//
// Matching is exact-normalised rather than fuzzy, deliberately: a false
// "already mapped" that hides a real gap is worse than a missed match.

export type Rule = {
  id: string
  oldSectionName: string
  newTargetSection: string
  transformationRule: string
  priority: number
  isActive: boolean
}

export type BlockMapping = {
  blockId: string
  targetSection: string | null
  mappingRuleId: string | null
  status: 'mapped' | 'unmapped' | 'ambiguous'
  note?: string
}

function matches(headingText: string, ruleName: string): boolean {
  const a = normaliseText(headingText).toLowerCase()
  const b = normaliseText(ruleName).toLowerCase()
  // Exact, or the heading is the rule name with numbering in front
  // ("3. Responsibilities" matching a rule for "Responsibilities").
  return a === b || a.replace(/^[\d.\s]+/, '') === b
}

/**
 * Blocks inherit the mapping of the heading above them, which is how a section
 * maps as a unit. A block before any heading has no section to belong to and is
 * reported unmapped rather than attached to the first rule that happens to fit.
 */
export function mapBlocks(blocks: DocBlock[], rules: Rule[]): BlockMapping[] {
  const active = rules
    .filter((r) => r.isActive)
    .slice()
    .sort((a, b) => a.priority - b.priority)

  const mappings: BlockMapping[] = []
  let current: { rule: Rule | null; ambiguous: boolean } = { rule: null, ambiguous: false }

  for (const block of blocks) {
    if (block.type === 'heading') {
      const hits = active.filter((r) => matches(block.text, r.oldSectionName))
      if (hits.length === 0) {
        current = { rule: null, ambiguous: false }
      } else if (hits.length === 1) {
        current = { rule: hits[0]!, ambiguous: false }
      } else {
        // Several rules claim the same source section. Priority picks one, but
        // the collision is recorded so a human can fix the mapping version.
        const distinct = new Set(hits.map((h) => h.newTargetSection))
        current = { rule: hits[0]!, ambiguous: distinct.size > 1 }
      }
    }

    if (!current.rule) {
      mappings.push({
        blockId: block.blockId,
        targetSection: null,
        mappingRuleId: null,
        status: 'unmapped',
        note: 'No approved mapping rule covers this content.',
      })
      continue
    }

    mappings.push({
      blockId: block.blockId,
      targetSection: current.rule.newTargetSection,
      mappingRuleId: current.rule.id,
      status: current.ambiguous ? 'ambiguous' : 'mapped',
      note: current.ambiguous
        ? 'More than one active mapping rule matches this section, with different targets.'
        : undefined,
    })
  }

  return mappings
}

/** Target sections the active mapping version can produce. */
export function targetSectionsFor(rules: Rule[]): string[] {
  return [...new Set(rules.filter((r) => r.isActive).map((r) => r.newTargetSection))]
}
