import { OUTPUT_VERSION } from '../enums.ts'

// The output naming rule from the brief:
//   REVISED - [Document Code] [Document Title] (v2.1)
// e.g. REVISED - PPD-SGL-CG-1.1.1 Leadership and Corporate Governance (v2.1)
//
// One function, because the title is also a uniqueness key (a revised document
// must not be created twice in the same folder) — two implementations that
// drifted apart would silently defeat that check.

export type TitleParts = { documentCode: string | null; documentTitle: string }

export function buildOutputTitle(parts: TitleParts, version = OUTPUT_VERSION): string {
  const code = (parts.documentCode ?? '').trim()
  const title = parts.documentTitle.trim().replace(/\s+/g, ' ')
  const stem = code ? `${code} ${title}` : title
  return `REVISED - ${stem} (v${version})`
}

// Document codes look like PPD-SGL-CG-1.1.1 — letters/digits in hyphenated
// groups, ending in a dotted clause number. Anchored to the start of the title
// because that is where the code sits in the source documents.
const CODE_RE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:\.\d+)*)\s+(.*)$/

/**
 * Split "PPD-SGL-CG-1.1.1 Leadership and Corporate Governance" into its code and
 * title. Returns a null code when the title carries none — the code is never
 * invented, and a document without one keeps its title unchanged.
 */
export function splitDocumentCode(sourceTitle: string): TitleParts {
  const trimmed = sourceTitle.trim().replace(/\s+/g, ' ')
  const match = trimmed.match(CODE_RE)
  if (!match) return { documentCode: null, documentTitle: trimmed }
  return { documentCode: match[1]!, documentTitle: match[2]!.trim() }
}
