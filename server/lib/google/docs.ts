import type { Fetcher } from './drive.ts'
import { DriveError } from './drive.ts'

// Google Docs v1 over fetch. Two operations only: read a document's structure,
// and batch-update a target. gd4_simulator never used this API — it exported
// Docs as plain text through Drive — so none of this could be reused.

const DOCS = 'https://docs.googleapis.com/v1/documents'

/** Minimal shape of the parts of a Docs document this app reads. */
export type GoogleDoc = {
  documentId: string
  title: string
  revisionId?: string
  body?: { content?: StructuralElement[] }
  headers?: Record<string, { content?: StructuralElement[] }>
  footers?: Record<string, { content?: StructuralElement[] }>
  footnotes?: Record<string, { content?: StructuralElement[] }>
  lists?: Record<string, unknown>
  namedStyles?: { styles?: { namedStyleType?: string }[] }
  inlineObjects?: Record<string, InlineObject>
}

export type StructuralElement = {
  startIndex?: number
  endIndex?: number
  paragraph?: Paragraph
  table?: Table
  sectionBreak?: unknown
  tableOfContents?: unknown
}

export type Paragraph = {
  elements?: ParagraphElement[]
  paragraphStyle?: { namedStyleType?: string; headingId?: string }
  bullet?: { listId?: string; nestingLevel?: number }
}

export type ParagraphElement = {
  startIndex?: number
  endIndex?: number
  textRun?: { content?: string; textStyle?: { link?: { url?: string } } }
  inlineObjectElement?: { inlineObjectId?: string }
  pageBreak?: unknown
}

export type Table = {
  rows?: number
  columns?: number
  tableRows?: { tableCells?: { content?: StructuralElement[] }[] }[]
}

export type InlineObject = {
  inlineObjectProperties?: {
    embeddedObject?: {
      title?: string
      description?: string
      imageProperties?: { contentUri?: string; sourceUri?: string }
    }
  }
}

export type DocsClient = ReturnType<typeof makeDocsClient>

export function makeDocsClient(accessToken: string, fetchImpl: Fetcher = fetch) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${DOCS}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      let detail = body.slice(0, 300)
      try {
        detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? detail
      } catch {
        /* keep raw */
      }
      throw new DriveError(detail || `Docs request failed (${res.status})`, res.status)
    }
    return (await res.json()) as T
  }

  return {
    async getDocument(documentId: string): Promise<GoogleDoc> {
      return call<GoogleDoc>(`/${encodeURIComponent(documentId)}`)
    },

    /**
     * The ONLY write path in this app. Callers must have already proved the
     * target is a revised document — see assertNotSourceDocument in
     * migration/stages.ts, which is what actually keeps sources read-only.
     */
    async batchUpdate(documentId: string, requests: unknown[]): Promise<void> {
      if (requests.length === 0) return
      await call(`/${encodeURIComponent(documentId)}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests }),
      })
    },
  }
}
