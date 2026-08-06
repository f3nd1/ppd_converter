import { createHash } from 'node:crypto'

// The internal JSON document model. A raw Google Doc is never sent to the AI —
// it is parsed into this first, so every piece of content has a stable identity
// that validation can account for afterwards.

export type BlockLink = { text: string; url: string }

export type DocBlock = {
  /** Stable across re-scans while the text is unchanged. See makeBlockId. */
  blockId: string
  type: 'heading' | 'paragraph' | 'listItem' | 'table' | 'image' | 'pageBreak'
  text: string
  textHash: string
  level?: number
  styleName?: string
  numbering?: { listId?: string; nestingLevel?: number }
  links: BlockLink[]
  table?: { rows: number; cols: number; cells: string[][] }
  imageRef?: { objectId: string; sourceUri?: string; altText?: string }
  sourceLocation?: { startIndex?: number; endIndex?: number; segmentId?: string }
  parentBlockId?: string
  order: number
}

export type DocMetadata = {
  googleFileId: string
  title: string
  documentCode: string | null
  documentTitle: string
  revisionId?: string
  modifiedTime?: string
}

export type HeaderFooter = { id: string; text: string }

export type DocumentModel = {
  metadata: DocMetadata
  blocks: DocBlock[]
  headers: HeaderFooter[]
  footers: HeaderFooter[]
  footnotes: HeaderFooter[]
  namedStyles: string[]
  /** Page numbering lives in the template's header/footer and is preserved by
   *  copying it, never regenerated. Recorded so validation can say so. */
  pageNumbering: { inHeader: boolean; inFooter: boolean }
}

/** Whitespace-insensitive so trivial reflowing does not look like a content change. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function hashText(text: string): string {
  return createHash('sha256').update(normaliseText(text)).digest('hex')
}

/**
 * Deterministic and stable: same document, same position, same text produces
 * the same id on every scan. The text hash is included on purpose — if the
 * source is edited, the id changes, and that difference is the signal that the
 * source drifted rather than something to paper over by renumbering.
 */
export function makeBlockId(googleFileId: string, ordinal: number, text: string): string {
  const docPart = googleFileId.slice(0, 8)
  const textPart = hashText(text).slice(0, 8)
  return `${docPart}-${String(ordinal).padStart(4, '0')}-${textPart}`
}

/** Everything a reference check has to account for, pulled out of the model. */
export function collectLinks(blocks: DocBlock[]): BlockLink[] {
  return blocks.flatMap((b) => b.links)
}

/**
 * Tokens that must survive migration unchanged: clause numbers, dates, money,
 * percentages, plain integers and document codes. Extracted by pure regex so
 * "facts were preserved" is a set comparison rather than an opinion.
 */
export function extractFactTokens(text: string): string[] {
  const patterns: RegExp[] = [
    // Document codes, e.g. PPD-SGL-CG-1.1.1. The trailing (?:\.\d+)* is
    // load-bearing: without it this stopped at "PPD-SGL-CG-1" and the
    // fact-preservation check would have compared a truncated code.
    /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+(?:\.\d+)*)+/g,
    /\b\d+(?:\.\d+)+\b/g, // clause numbers, e.g. 1.1.1
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // dates 1/2/2026
    /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
    /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
    /\b\d+(?:\.\d+)?\s*%/g, // percentages
    /(?:S?\$|SGD)\s?\d[\d,]*(?:\.\d+)?/gi, // money
    /\b\d[\d,]*(?:\.\d+)?\b/g, // any remaining number
  ]
  const found = new Set<string>()
  for (const re of patterns) {
    for (const match of text.matchAll(re)) found.add(match[0].trim())
  }
  return [...found]
}
