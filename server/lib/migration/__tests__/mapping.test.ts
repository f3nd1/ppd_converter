import { describe, expect, it } from 'vitest'
import type { DocBlock } from '../../doc/model.ts'
import { hashText, makeBlockId } from '../../doc/model.ts'
import { mapBlocks, targetSectionsFor, type Rule } from '../mapping.ts'

function block(text: string, order: number, type: DocBlock['type'] = 'paragraph'): DocBlock {
  return {
    blockId: makeBlockId('doc12345', order, text),
    type,
    text,
    textHash: hashText(text),
    links: [],
    order,
  }
}

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  oldSectionName: 'Responsibilities',
  newTargetSection: 'PRACI Responsibility Matrix',
  transformationRule: 'Convert to the PRACI matrix.',
  priority: 100,
  isActive: true,
  ...over,
})

describe('mapBlocks', () => {
  it('maps content under a matching heading', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('The Principal approves.', 1)]
    const result = mapBlocks(blocks, [rule()])
    expect(result[1]!.status).toBe('mapped')
    expect(result[1]!.targetSection).toBe('PRACI Responsibility Matrix')
  })

  it('matches a heading that carries leading numbering', () => {
    const blocks = [block('3. Responsibilities', 0, 'heading'), block('Body', 1)]
    expect(mapBlocks(blocks, [rule()])[1]!.status).toBe('mapped')
  })

  it('reports unmapped rather than guessing when no rule matches', () => {
    const blocks = [block('Glossary', 0, 'heading'), block('Terms.', 1)]
    const result = mapBlocks(blocks, [rule()])
    expect(result.every((r) => r.status === 'unmapped')).toBe(true)
    expect(result[0]!.note).toContain('No approved mapping rule')
  })

  it('reports unmapped for content before any heading', () => {
    const blocks = [block('Orphan text.', 0)]
    expect(mapBlocks(blocks, [rule()])[0]!.status).toBe('unmapped')
  })

  it('ignores inactive rules', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('Body', 1)]
    expect(mapBlocks(blocks, [rule({ isActive: false })])[1]!.status).toBe('unmapped')
  })

  it('flags ambiguity when two rules claim a section with different targets', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('Body', 1)]
    const result = mapBlocks(blocks, [
      rule({ id: 'a', priority: 1 }),
      rule({ id: 'b', priority: 2, newTargetSection: 'Procedure' }),
    ])
    expect(result[1]!.status).toBe('ambiguous')
    expect(result[1]!.note).toContain('More than one active mapping rule')
  })

  it('is not ambiguous when duplicate rules agree on the target', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('Body', 1)]
    const result = mapBlocks(blocks, [rule({ id: 'a', priority: 1 }), rule({ id: 'b', priority: 2 })])
    expect(result[1]!.status).toBe('mapped')
  })

  it('lowest priority number wins', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('Body', 1)]
    const result = mapBlocks(blocks, [
      rule({ id: 'low', priority: 50 }),
      rule({ id: 'high', priority: 900, newTargetSection: 'Procedure' }),
    ])
    expect(result[1]!.mappingRuleId).toBe('low')
  })

  it('switches section when a new heading arrives', () => {
    const blocks = [
      block('Responsibilities', 0, 'heading'),
      block('A', 1),
      block('Glossary', 2, 'heading'),
      block('B', 3),
    ]
    const result = mapBlocks(blocks, [rule()])
    expect(result[1]!.status).toBe('mapped')
    expect(result[3]!.status).toBe('unmapped')
  })

  it('returns exactly one mapping per block so completeness is checkable', () => {
    const blocks = [block('Responsibilities', 0, 'heading'), block('A', 1), block('B', 2)]
    expect(mapBlocks(blocks, [rule()])).toHaveLength(blocks.length)
  })

  it('returns no mappings at all when there are no rules — migration stays blocked', () => {
    const blocks = [block('Responsibilities', 0, 'heading')]
    expect(mapBlocks(blocks, []).every((m) => m.status === 'unmapped')).toBe(true)
  })
})

describe('targetSectionsFor', () => {
  it('lists distinct active target sections', () => {
    expect(
      targetSectionsFor([
        rule({ id: 'a' }),
        rule({ id: 'b' }),
        rule({ id: 'c', newTargetSection: 'Procedure' }),
        rule({ id: 'd', newTargetSection: 'Ignored', isActive: false }),
      ]),
    ).toEqual(['PRACI Responsibility Matrix', 'Procedure'])
  })
})
