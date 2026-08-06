import type { RewriteOutput } from '../ai/schemas.ts'

// Builds Docs API batchUpdate requests to populate a copied template.
//
// The template marks each target section with a placeholder token, e.g.
// {{POLICY_AND_APPROACH}}. That mechanism is configurable rather than hardcoded
// because the approved template is still being finalised (plan §21 O-2) — the
// token set is stored in the template's configSnapshot at activation time.
//
// Requests are built here as pure data so they can be asserted in tests without
// touching Google.

export function placeholderFor(sectionName: string): string {
  return `{{${sectionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}}}`
}

export type SectionContent = { name: string; content: string }

/**
 * Flattens the AI's structured output into the text that will be written to
 * each section. Tables are rendered as text here and inserted as real tables by
 * the request builder below.
 */
export function sectionsFromRewrite(rewrite: RewriteOutput): SectionContent[] {
  const merged = new Map<string, string[]>()
  for (const section of rewrite.sections) {
    const parts = merged.get(section.targetSection) ?? []
    if (section.format === 'table' && section.table) {
      parts.push(
        [section.table.headers, ...section.table.rows].map((row) => row.join(' | ')).join('\n'),
      )
    } else {
      parts.push(...section.paragraphs)
    }
    merged.set(section.targetSection, parts)
  }
  return [...merged.entries()].map(([name, parts]) => ({
    name,
    content: parts.join('\n\n'),
  }))
}

export type BatchRequest = Record<string, unknown>

/**
 * replaceAllText per section. Chosen over index-based insertion because indices
 * shift after every edit, and a template whose layout changes would silently
 * write content into the wrong place. Placeholder replacement is position-
 * independent and therefore survives template edits.
 *
 * Header, footer and page numbering are untouched — they come from the copied
 * template and must be preserved.
 */
export function buildPopulateRequests(
  sections: SectionContent[],
  allSectionNames: string[],
): BatchRequest[] {
  const requests: BatchRequest[] = []
  const bySection = new Map(sections.map((s) => [s.name, s.content]))

  for (const name of allSectionNames) {
    requests.push({
      replaceAllText: {
        containsText: { text: placeholderFor(name), matchCase: true },
        // A section with no mapped content is emptied rather than left showing
        // a raw placeholder to a reviewer.
        replaceText: bySection.get(name) ?? '',
      },
    })
  }
  return requests
}

/** Fills the template's title/code/version tokens. Values only, never invented. */
export function buildMetadataRequests(meta: {
  documentCode: string | null
  documentTitle: string
  outputVersion: string
}): BatchRequest[] {
  const replacements: [string, string][] = [
    ['{{DOCUMENT_CODE}}', meta.documentCode ?? ''],
    ['{{DOCUMENT_TITLE}}', meta.documentTitle],
    ['{{VERSION}}', meta.outputVersion],
  ]
  return replacements.map(([text, replaceText]) => ({
    replaceAllText: { containsText: { text, matchCase: true }, replaceText },
  }))
}
