import { describe, expect, it } from 'vitest'
import type { RewriteOutput } from '../../ai/schemas.ts'
import type { DocBlock } from '../../doc/model.ts'
import { hashText, makeBlockId, normaliseText } from '../../doc/model.ts'
import { buildChangeRecords } from '../changes.ts'
import type { BlockMapping } from '../mapping.ts'

function block(text: string, order: number): DocBlock {
  return {
    blockId: makeBlockId('doc12345', order, text),
    type: 'paragraph',
    text,
    textHash: hashText(text),
    links: [],
    order,
  }
}

const blocks = [
  block('The Principal shall approve all fee refunds within 7 working days.', 0),
  block('Records are retained for 5 years.', 1),
  block('This paragraph has no mapping rule.', 2),
]

const sections = [
  {
    name: 'Procedure',
    content:
      'The Principal shall approve all fee refunds within 7 working days.\n\nRecords are retained for 5 years.',
  },
]

const mappings: BlockMapping[] = [
  { blockId: blocks[0]!.blockId, targetSection: 'Procedure', mappingRuleId: 'r1', status: 'mapped' },
  { blockId: blocks[1]!.blockId, targetSection: 'Procedure', mappingRuleId: 'r1', status: 'mapped' },
  { blockId: blocks[2]!.blockId, targetSection: null, mappingRuleId: null, status: 'unmapped' },
]

const rewrite: RewriteOutput = {
  overallReasoning: 'Mapped procedure content.',
  sections: [],
  changes: [
    {
      reason: 'Rewritten for clarity.',
      changeType: 'text_rewritten',
      sourceSection: 'Procedure',
      targetSection: 'Procedure',
      sourceBlockId: blocks[0]!.blockId,
      confidence: 0.9,
    },
  ],
  unmappedBlockIds: [blocks[2]!.blockId],
  ambiguities: [],
}

describe('buildChangeRecords', () => {
  const records = buildChangeRecords({ rewrite, blocks, mappings, sections })

  it('records a change for EVERY source block, not just the reported ones', () => {
    const covered = new Set(records.map((r) => r.sourceBlockId))
    for (const b of blocks) expect(covered.has(b.blockId)).toBe(true)
  })

  it('numbers changes sequentially from 1', () => {
    expect(records.map((r) => r.changeNumber)).toEqual(records.map((_, i) => i + 1))
  })

  it('NEVER fabricates an original excerpt — it is always real source text', () => {
    const sourceTexts = blocks.map((b) => normaliseText(b.text))
    for (const record of records) {
      if (!record.originalExcerpt) continue
      const clean = record.originalExcerpt.replace(/…$/, '')
      expect(sourceTexts.some((text) => text.includes(clean))).toBe(true)
    }
  })

  it('NEVER fabricates a revised excerpt — it is always real target text', () => {
    const targetTexts = sections.map((s) => normaliseText(s.content))
    for (const record of records) {
      if (!record.revisedExcerpt) continue
      const clean = record.revisedExcerpt.replace(/…$/, '')
      expect(targetTexts.some((text) => text.includes(clean))).toBe(true)
    }
  })

  it('marks unmapped content as content_unmapped with no revised excerpt', () => {
    const unmapped = records.find((r) => r.sourceBlockId === blocks[2]!.blockId)!
    expect(unmapped.changeType).toBe('content_unmapped')
    expect(unmapped.revisedExcerpt).toBeNull()
    expect(unmapped.reason).toContain('No approved mapping rule')
  })

  it('marks silently-carried content as content_unchanged rather than omitting it', () => {
    const carried = records.find((r) => r.sourceBlockId === blocks[1]!.blockId)!
    expect(carried.changeType).toBe('content_unchanged')
  })

  it('keeps the AI-reported change type and reason', () => {
    const reported = records.find((r) => r.sourceBlockId === blocks[0]!.blockId)!
    expect(reported.changeType).toBe('text_rewritten')
    expect(reported.reason).toBe('Rewritten for clarity.')
    expect(reported.confidence).toBe(0.9)
  })

  it('preserves numbers verbatim inside the stored excerpts', () => {
    const record = records.find((r) => r.sourceBlockId === blocks[0]!.blockId)!
    expect(record.originalExcerpt).toContain('7 working days')
  })
})
