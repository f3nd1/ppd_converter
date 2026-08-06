import { describe, expect, it } from 'vitest'
import type { DocBlock } from '../../doc/model.ts'
import { hashText, makeBlockId } from '../../doc/model.ts'
import { runDeterministicValidation, type DeterministicInput } from '../deterministic.ts'

function block(text: string, order = 0, links: { text: string; url: string }[] = []): DocBlock {
  return {
    blockId: makeBlockId('doc12345', order, text),
    type: 'paragraph',
    text,
    textHash: hashText(text),
    links,
    order,
  }
}

const scan = new Date('2026-08-01T10:00:00Z')

function baseInput(overrides: Partial<DeterministicInput> = {}): DeterministicInput {
  const blocks = [block('Clause 4.2.1 applies from 1 January 2026.', 0)]
  return {
    sourceBlocks: blocks,
    blockMappings: new Map(blocks.map((b) => [b.blockId, 'mapped' as const])),
    targetSections: [
      { name: 'Procedure', content: 'Clause 4.2.1 applies from 1 January 2026.' },
    ],
    requiredTargetSections: ['Procedure'],
    sourceDocumentCode: 'PPD-SGL-CG-1.1.1',
    targetTitle: 'REVISED - PPD-SGL-CG-1.1.1 Leadership (v2.1)',
    expectedDestinationFolderId: 'folder1',
    actualDestinationFolderId: 'folder1',
    expectedTemplateId: 'tpl1',
    actualTemplateId: 'tpl1',
    sourceModifiedTimeAtScan: scan,
    sourceModifiedTimeNow: new Date(scan),
    duplicateTargetFound: false,
    requiredMetadataPresent: true,
    ...overrides,
  }
}

const find = (results: ReturnType<typeof runDeterministicValidation>, check: string) =>
  results.find((r) => r.checkPerformed === check)!

describe('runDeterministicValidation', () => {
  it('passes a clean migration', () => {
    const results = runDeterministicValidation(baseInput())
    expect(results.filter((r) => r.result === 'fail')).toHaveLength(0)
  })

  it('FAILS when a clause number is missing from the target', () => {
    const results = runDeterministicValidation(
      baseInput({ targetSections: [{ name: 'Procedure', content: 'Something applies from 1 January 2026.' }] }),
    )
    const check = find(results, 'Clause numbers are unchanged')
    expect(check.result).toBe('fail')
    expect(check.severity).toBe('critical')
    expect(check.details).toContain('4.2.1')
  })

  it('FAILS when the document code is missing from the target title', () => {
    const results = runDeterministicValidation(baseInput({ targetTitle: 'REVISED - Leadership (v2.1)' }))
    const check = find(results, 'Document code is unchanged')
    expect(check.result).toBe('fail')
    expect(check.severity).toBe('critical')
  })

  it('warns when a date is dropped', () => {
    const results = runDeterministicValidation(
      baseInput({ targetSections: [{ name: 'Procedure', content: 'Clause 4.2.1 applies.' }] }),
    )
    expect(find(results, 'Dates and factual values are unchanged').result).toBe('warning')
  })

  it('FAILS when a source block has no mapping status', () => {
    const results = runDeterministicValidation(baseInput({ blockMappings: new Map() }))
    const check = find(results, 'Every source content block has a mapping status')
    expect(check.result).toBe('fail')
  })

  it('warns about unmapped blocks so nothing disappears silently', () => {
    const input = baseInput()
    const id = input.sourceBlocks[0]!.blockId
    const results = runDeterministicValidation({
      ...input,
      blockMappings: new Map([[id, 'unmapped']]),
    })
    expect(find(results, 'Source sections mapped to a target section').result).toBe('warning')
  })

  it('warns when a hyperlink is not carried across', () => {
    const blocks = [block('See policy', 0, [{ text: 'policy', url: 'https://example.com/p' }])]
    const results = runDeterministicValidation(
      baseInput({
        sourceBlocks: blocks,
        blockMappings: new Map(blocks.map((b) => [b.blockId, 'mapped' as const])),
        targetSections: [{ name: 'Procedure', content: 'See policy' }],
      }),
    )
    expect(find(results, 'Every source hyperlink is accounted for').result).toBe('warning')
  })

  it('FAILS when a required target section is missing', () => {
    const results = runDeterministicValidation(
      baseInput({ requiredTargetSections: ['Procedure', 'PRACI Responsibility Matrix'] }),
    )
    const check = find(results, 'All required target sections exist')
    expect(check.result).toBe('fail')
    expect(check.details).toContain('PRACI')
  })

  it('FAILS when the source changed since the scan', () => {
    const results = runDeterministicValidation(
      baseInput({ sourceModifiedTimeNow: new Date('2026-08-05T10:00:00Z') }),
    )
    expect(find(results, 'Source document was not changed').result).toBe('fail')
  })

  it('FAILS when a duplicate target exists', () => {
    const results = runDeterministicValidation(baseInput({ duplicateTargetFound: true }))
    expect(find(results, 'No unintended duplicate target exists').result).toBe('fail')
  })

  it('FAILS when the wrong template was used', () => {
    const results = runDeterministicValidation(baseInput({ actualTemplateId: 'other' }))
    expect(find(results, 'Active template was used').result).toBe('fail')
  })

  it('FAILS when the document landed in the wrong folder', () => {
    const results = runDeterministicValidation(baseInput({ actualDestinationFolderId: 'elsewhere' }))
    expect(find(results, 'Target folder is correct').result).toBe('fail')
  })

  it('FAILS when required metadata is missing', () => {
    const results = runDeterministicValidation(baseInput({ requiredMetadataPresent: false }))
    expect(find(results, 'Required metadata is stored').result).toBe('fail')
  })

  it('marks every failure as needing human review', () => {
    const results = runDeterministicValidation(baseInput({ actualTemplateId: 'other' }))
    expect(results.filter((r) => r.result === 'fail').every((r) => r.humanReviewRequired)).toBe(true)
  })
})
