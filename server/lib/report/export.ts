import { toDisplayTimestamps } from '../activity.ts'

// CSV / JSON / printable HTML. No PDF library: every reliable option means
// Chromium or a heavy native dependency, which on a 1.9 GiB box shared with four
// other apps is the wrong trade. The printable HTML prints to PDF from the
// browser in two clicks.

/** RFC 4180 quoting. A stray quote or newline in a document title would
 *  otherwise shift every following column. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return columns?.length ? `${columns.join(',')}\n` : ''
  const cols = columns ?? Object.keys(rows[0]!)
  const lines = [cols.join(',')]
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','))
  return `${lines.join('\n')}\n`
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type HtmlSection = {
  heading: string
  /** Rendered as a table when rows are present, otherwise as a note. */
  columns?: string[]
  rows?: Record<string, unknown>[]
  note?: string
}

export function toPrintableHtml(args: {
  title: string
  subtitle?: string
  generatedAt: Date
  sections: HtmlSection[]
}): string {
  const stamps = toDisplayTimestamps(args.generatedAt)

  const body = args.sections
    .map((section) => {
      if (!section.rows?.length) {
        return `<section><h2>${escapeHtml(section.heading)}</h2><p class="empty">${escapeHtml(
          section.note ?? 'Nothing to report.',
        )}</p></section>`
      }
      const cols = section.columns ?? Object.keys(section.rows[0]!)
      const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
      const rows = section.rows
        .map(
          (row) =>
            `<tr>${cols.map((c) => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`,
        )
        .join('')
      return `<section><h2>${escapeHtml(section.heading)}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${escapeHtml(args.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #16191d; font-size: 13px; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .meta { color: #5c6470; margin-bottom: 1.5rem; }
  h2 { font-size: 1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #d8dde3; padding-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d8dde3; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f3f5f8; }
  .empty { color: #5c6470; }
  @media print { body { margin: 0.5cm; } section { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escapeHtml(args.title)}</h1>
${args.subtitle ? `<p class="meta">${escapeHtml(args.subtitle)}</p>` : ''}
<p class="meta">Generated ${escapeHtml(stamps.singapore)} (Asia/Singapore) &middot; ${escapeHtml(stamps.utc)} UTC</p>
${body}
</body>
</html>`
}
