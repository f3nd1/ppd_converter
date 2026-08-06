// Pure Google URL parsing. No network, no side effects — so the whole surface is
// unit-testable, which matters because a wrong ID here means reading or writing
// the wrong document.
//
// This deliberately does NOT decide whether something is a folder or a document
// from the URL shape alone. A URL only yields a *candidate* ID and a *hint*; the
// real type is confirmed against the Drive API (see drive.ts). A user can paste a
// /file/d/ link to a Google Doc, and guessing from the path would get it wrong.

export type ParsedGoogleUrl = {
  resourceId: string
  /** What the URL shape suggests. Must still be confirmed via the API. */
  hint: 'folder' | 'document' | 'unknown'
}

export type ParseFailure = {
  ok: false
  /** Shown to the user verbatim, so it has to say what to do about it. */
  reason: string
}

export type ParseSuccess = { ok: true; value: ParsedGoogleUrl }
export type ParseResult = ParseSuccess | ParseFailure

const ID_CHARS = '[A-Za-z0-9_-]+'

const PATTERNS: { re: RegExp; hint: ParsedGoogleUrl['hint'] }[] = [
  { re: new RegExp(`/folders/(${ID_CHARS})`), hint: 'folder' },
  { re: new RegExp(`/document/d/(${ID_CHARS})`), hint: 'document' },
  { re: new RegExp(`/file/d/(${ID_CHARS})`), hint: 'unknown' },
  { re: new RegExp(`/spreadsheets/d/(${ID_CHARS})`), hint: 'unknown' },
  { re: new RegExp(`/presentation/d/(${ID_CHARS})`), hint: 'unknown' },
  { re: new RegExp(`[?&]id=(${ID_CHARS})`), hint: 'unknown' },
]

const ALLOWED_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
])

export function parseGoogleUrl(input: string): ParseResult {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, reason: 'No link was provided.' }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return {
      ok: false,
      reason: 'That is not a valid web address. Paste the full link, starting with https://',
    }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'The link must start with https://' }
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      reason:
        `"${url.hostname}" is not a Google Drive or Google Docs address. ` +
        `Expected drive.google.com or docs.google.com.`,
    }
  }

  for (const { re, hint } of PATTERNS) {
    const match = url.href.match(re)
    if (match?.[1]) return { ok: true, value: { resourceId: match[1], hint } }
  }

  return {
    ok: false,
    reason:
      'No Google resource ID was found in that link. Open the folder or document in Google ' +
      'and copy the address from the browser bar.',
  }
}

/** Convenience for call sites that only want the ID. */
export function extractResourceId(input: string): string | null {
  const parsed = parseGoogleUrl(input)
  return parsed.ok ? parsed.value.resourceId : null
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const DOCUMENT_MIME = 'application/vnd.google-apps.document'

export function resourceTypeFromMime(mimeType: string): 'folder' | 'document' | 'other' {
  if (mimeType === FOLDER_MIME) return 'folder'
  if (mimeType === DOCUMENT_MIME) return 'document'
  return 'other'
}

export function documentUrl(googleDocId: string): string {
  return `https://docs.google.com/document/d/${googleDocId}/edit`
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}
