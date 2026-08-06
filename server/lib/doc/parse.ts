import type { GoogleDoc, Paragraph, StructuralElement } from '../google/docs.ts'
import { splitDocumentCode } from './title.ts'
import {
  type BlockLink,
  type DocBlock,
  type DocumentModel,
  hashText,
  makeBlockId,
  normaliseText,
} from './model.ts'

// Google Docs JSON → the internal model. Pure: takes an already-fetched document
// and returns the model, so the whole parser is unit-testable with a fixture and
// never needs a network call or a real document.

function paragraphText(p: Paragraph): string {
  return (p.elements ?? []).map((el) => el.textRun?.content ?? '').join('')
}

function paragraphLinks(p: Paragraph): BlockLink[] {
  const links: BlockLink[] = []
  for (const el of p.elements ?? []) {
    const url = el.textRun?.textStyle?.link?.url
    if (url) links.push({ text: (el.textRun?.content ?? '').trim(), url })
  }
  return links
}

function headingLevel(namedStyleType?: string): number | undefined {
  const match = namedStyleType?.match(/^HEADING_(\d)$/)
  return match ? Number(match[1]) : undefined
}

function elementsToText(content: StructuralElement[] | undefined): string {
  return normaliseText(
    (content ?? [])
      .map((el) => (el.paragraph ? paragraphText(el.paragraph) : ''))
      .join(' '),
  )
}

export function parseGoogleDoc(
  doc: GoogleDoc,
  opts: { modifiedTime?: string } = {},
): DocumentModel {
  const blocks: DocBlock[] = []
  let ordinal = 0

  const push = (block: Omit<DocBlock, 'blockId' | 'textHash' | 'order'>) => {
    // Blank paragraphs carry no content to account for and would otherwise all
    // hash identically, producing duplicate ids.
    if (block.type !== 'pageBreak' && block.type !== 'image' && !normaliseText(block.text)) return
    blocks.push({
      ...block,
      blockId: makeBlockId(doc.documentId, ordinal, block.text),
      textHash: hashText(block.text),
      order: ordinal,
    })
    ordinal += 1
  }

  for (const el of doc.body?.content ?? []) {
    const location = { startIndex: el.startIndex, endIndex: el.endIndex }

    if (el.paragraph) {
      const p = el.paragraph
      const text = paragraphText(p)
      const style = p.paragraphStyle?.namedStyleType
      const level = headingLevel(style)

      if ((p.elements ?? []).some((e) => e.pageBreak)) {
        push({ type: 'pageBreak', text: '', links: [], sourceLocation: location })
      }

      for (const e of p.elements ?? []) {
        const objectId = e.inlineObjectElement?.inlineObjectId
        if (!objectId) continue
        const embedded = doc.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject
        push({
          type: 'image',
          // Images are referenced, never re-uploaded — the Docs API takes a URI.
          text: embedded?.title ?? embedded?.description ?? '',
          links: [],
          imageRef: {
            objectId,
            sourceUri: embedded?.imageProperties?.sourceUri,
            altText: embedded?.description ?? embedded?.title,
          },
          sourceLocation: location,
        })
      }

      if (!normaliseText(text)) continue

      push({
        type: level !== undefined ? 'heading' : p.bullet ? 'listItem' : 'paragraph',
        text,
        level,
        styleName: style,
        numbering: p.bullet
          ? { listId: p.bullet.listId, nestingLevel: p.bullet.nestingLevel ?? 0 }
          : undefined,
        links: paragraphLinks(p),
        sourceLocation: location,
      })
      continue
    }

    if (el.table) {
      const cells = (el.table.tableRows ?? []).map((row) =>
        (row.tableCells ?? []).map((cell) => elementsToText(cell.content)),
      )
      const links = (el.table.tableRows ?? []).flatMap((row) =>
        (row.tableCells ?? []).flatMap((cell) =>
          (cell.content ?? []).flatMap((c) => (c.paragraph ? paragraphLinks(c.paragraph) : [])),
        ),
      )
      push({
        type: 'table',
        text: cells.map((r) => r.join(' | ')).join('\n'),
        table: { rows: cells.length, cols: cells[0]?.length ?? 0, cells },
        links,
        sourceLocation: location,
      })
    }
  }

  const headers = Object.entries(doc.headers ?? {}).map(([id, h]) => ({
    id,
    text: elementsToText(h.content),
  }))
  const footers = Object.entries(doc.footers ?? {}).map(([id, f]) => ({
    id,
    text: elementsToText(f.content),
  }))
  const footnotes = Object.entries(doc.footnotes ?? {}).map(([id, f]) => ({
    id,
    text: elementsToText(f.content),
  }))

  const { documentCode, documentTitle } = splitDocumentCode(doc.title ?? '')

  // Docs renders page numbers as a field inside a header or footer; the text is
  // empty at read time, so presence of the segment is the only honest signal.
  const hasPageNumber = (segments: { text: string }[]) => segments.length > 0

  return {
    metadata: {
      googleFileId: doc.documentId,
      title: doc.title ?? '',
      documentCode,
      documentTitle,
      revisionId: doc.revisionId,
      modifiedTime: opts.modifiedTime,
    },
    blocks,
    headers,
    footers,
    footnotes,
    namedStyles: (doc.namedStyles?.styles ?? [])
      .map((s) => s.namedStyleType)
      .filter((s): s is string => Boolean(s)),
    pageNumbering: { inHeader: hasPageNumber(headers), inFooter: hasPageNumber(footers) },
  }
}
