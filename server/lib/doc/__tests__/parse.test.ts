import { describe, expect, it } from 'vitest'
import type { GoogleDoc } from '../../google/docs.ts'
import { extractFactTokens, makeBlockId, normaliseText } from '../model.ts'
import { parseGoogleDoc } from '../parse.ts'

function para(text: string, namedStyleType?: string, link?: string) {
  return {
    paragraph: {
      paragraphStyle: namedStyleType ? { namedStyleType } : undefined,
      elements: [{ textRun: { content: text, textStyle: link ? { link: { url: link } } : {} } }],
    },
  }
}

const doc: GoogleDoc = {
  documentId: 'doc123456789',
  title: 'PPD-SGL-CG-1.1.1 Leadership and Corporate Governance',
  revisionId: 'rev1',
  body: {
    content: [
      para('1. Purpose', 'HEADING_1'),
      para('This procedure applies from 1 January 2026 to all staff.'),
      para('See the policy at', undefined, 'https://example.com/policy'),
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [para('Role')] }, { content: [para('Duty')] }] },
            { tableCells: [{ content: [para('Principal')] }, { content: [para('Approve')] }] },
          ],
        },
      },
      para('   '), // blank — must not become a block
    ],
  },
  headers: { h1: { content: [para('United Ceres College')] } },
  footers: { f1: { content: [para('Page')] } },
  namedStyles: { styles: [{ namedStyleType: 'HEADING_1' }, { namedStyleType: 'NORMAL_TEXT' }] },
}

describe('parseGoogleDoc', () => {
  const model = parseGoogleDoc(doc, { modifiedTime: '2026-08-01T10:00:00Z' })

  it('splits the document code from the title without inventing one', () => {
    expect(model.metadata.documentCode).toBe('PPD-SGL-CG-1.1.1')
    expect(model.metadata.documentTitle).toBe('Leadership and Corporate Governance')
  })

  it('classifies headings, paragraphs and tables', () => {
    expect(model.blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'table',
    ])
  })

  it('records the heading level', () => {
    expect(model.blocks[0]!.level).toBe(1)
  })

  it('skips blank paragraphs so they cannot collide on identical hashes', () => {
    expect(model.blocks.every((b) => normaliseText(b.text).length > 0)).toBe(true)
  })

  it('captures hyperlinks so they can be accounted for later', () => {
    expect(model.blocks.flatMap((b) => b.links).map((l) => l.url)).toContain(
      'https://example.com/policy',
    )
  })

  it('flattens table cells while keeping the grid', () => {
    const table = model.blocks.find((b) => b.type === 'table')!
    expect(table.table).toEqual({
      rows: 2,
      cols: 2,
      cells: [
        ['Role', 'Duty'],
        ['Principal', 'Approve'],
      ],
    })
  })

  it('captures headers and footers, which carry the page numbering', () => {
    expect(model.headers[0]!.text).toBe('United Ceres College')
    expect(model.footers).toHaveLength(1)
    expect(model.pageNumbering).toEqual({ inHeader: true, inFooter: true })
  })

  it('gives every block a stable id', () => {
    const again = parseGoogleDoc(doc)
    expect(again.blocks.map((b) => b.blockId)).toEqual(model.blocks.map((b) => b.blockId))
    expect(new Set(model.blocks.map((b) => b.blockId)).size).toBe(model.blocks.length)
  })

  it('changes a block id when the text changes — drift is a signal, not noise', () => {
    expect(makeBlockId('doc123456789', 0, 'one')).not.toBe(makeBlockId('doc123456789', 0, 'two'))
  })

  it('ignores whitespace differences when hashing', () => {
    expect(makeBlockId('d', 0, 'a  b')).toBe(makeBlockId('d', 0, ' a b '))
  })
})

describe('extractFactTokens', () => {
  it('finds clause numbers, dates and document codes', () => {
    const tokens = extractFactTokens(
      'Clause 4.2.1 requires review by 1 January 2026 under PPD-SGL-CG-1.1.1, at 95% within S$1,200.',
    )
    expect(tokens).toContain('4.2.1')
    expect(tokens).toContain('1 January 2026')
    expect(tokens).toContain('PPD-SGL-CG-1.1.1')
    expect(tokens).toContain('95%')
    expect(tokens.some((t) => t.includes('1,200'))).toBe(true)
  })

  it('finds ISO and slash dates', () => {
    expect(extractFactTokens('Due 2026-03-01 or 1/2/2026')).toEqual(
      expect.arrayContaining(['2026-03-01', '1/2/2026']),
    )
  })

  it('returns nothing for prose with no facts in it', () => {
    expect(extractFactTokens('The committee shall meet regularly.')).toEqual([])
  })
})
