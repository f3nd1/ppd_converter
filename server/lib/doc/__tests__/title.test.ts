import { describe, expect, it } from 'vitest'
import { buildOutputTitle, splitDocumentCode } from '../title.ts'

describe('buildOutputTitle', () => {
  it('matches the naming rule from the brief exactly', () => {
    expect(
      buildOutputTitle({
        documentCode: 'PPD-SGL-CG-1.1.1',
        documentTitle: 'Leadership and Corporate Governance',
      }),
    ).toBe('REVISED - PPD-SGL-CG-1.1.1 Leadership and Corporate Governance (v2.1)')
  })

  it('always uses version 2.1 by default', () => {
    expect(buildOutputTitle({ documentCode: 'X-1', documentTitle: 'Y' })).toContain('(v2.1)')
  })

  it('omits the code rather than inventing one when there is none', () => {
    expect(buildOutputTitle({ documentCode: null, documentTitle: 'Untitled Procedure' })).toBe(
      'REVISED - Untitled Procedure (v2.1)',
    )
  })

  it('collapses stray whitespace so the title is a stable uniqueness key', () => {
    expect(
      buildOutputTitle({ documentCode: 'A-1', documentTitle: '  Spaced   Out  ' }),
    ).toBe('REVISED - A-1 Spaced Out (v2.1)')
  })
})

describe('splitDocumentCode', () => {
  it('splits a real code and title', () => {
    expect(splitDocumentCode('PPD-SGL-CG-1.1.1 Leadership and Corporate Governance')).toEqual({
      documentCode: 'PPD-SGL-CG-1.1.1',
      documentTitle: 'Leadership and Corporate Governance',
    })
  })

  it('returns a null code when the title has none — never invents one', () => {
    expect(splitDocumentCode('Staff Recruitment Procedure')).toEqual({
      documentCode: null,
      documentTitle: 'Staff Recruitment Procedure',
    })
  })

  it('does not mistake a leading clause number for a document code', () => {
    // "1.1.1 Something" has no letter prefix, so it is not a code.
    expect(splitDocumentCode('1.1.1 Something').documentCode).toBeNull()
  })

  it('round-trips through buildOutputTitle without altering the code', () => {
    const source = 'PPD-SGL-CG-1.1.1 Leadership and Corporate Governance'
    const parts = splitDocumentCode(source)
    expect(buildOutputTitle(parts)).toContain(parts.documentCode!)
  })
})
