import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_MIME,
  FOLDER_MIME,
  extractResourceId,
  parseGoogleUrl,
  resourceTypeFromMime,
} from '../urls.ts'

describe('parseGoogleUrl', () => {
  it('extracts a folder id', () => {
    const result = parseGoogleUrl(
      'https://drive.google.com/drive/folders/1SQ7Ltu8e0UQV1k7_M2eA6re_V79GVHnU',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.resourceId).toBe('1SQ7Ltu8e0UQV1k7_M2eA6re_V79GVHnU')
    expect(result.value.hint).toBe('folder')
  })

  it('extracts a document id', () => {
    const result = parseGoogleUrl('https://docs.google.com/document/d/abc123_XYZ-9/edit#heading=h.x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.resourceId).toBe('abc123_XYZ-9')
    expect(result.value.hint).toBe('document')
  })

  it('extracts an id from a /file/d/ link but does not guess the type', () => {
    const result = parseGoogleUrl('https://drive.google.com/file/d/fileId123/view')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.resourceId).toBe('fileId123')
    // A /file/d/ link can point at a Doc or something else — the API decides.
    expect(result.value.hint).toBe('unknown')
  })

  it('extracts an id from the ?id= form', () => {
    const result = parseGoogleUrl('https://drive.google.com/open?id=legacyId99')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.resourceId).toBe('legacyId99')
  })

  it('rejects a non-Google host', () => {
    const result = parseGoogleUrl('https://evil.example.com/drive/folders/abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('not a Google Drive')
  })

  it('rejects a lookalike host', () => {
    expect(parseGoogleUrl('https://drive.google.com.evil.net/drive/folders/abc').ok).toBe(false)
  })

  it('rejects http', () => {
    expect(parseGoogleUrl('http://drive.google.com/drive/folders/abc').ok).toBe(false)
  })

  it('rejects nonsense', () => {
    expect(parseGoogleUrl('not a url').ok).toBe(false)
    expect(parseGoogleUrl('').ok).toBe(false)
  })

  it('rejects a Google URL with no resource id', () => {
    const result = parseGoogleUrl('https://drive.google.com/drive/my-drive')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('No Google resource ID')
  })

  it('extractResourceId returns null rather than throwing', () => {
    expect(extractResourceId('nope')).toBeNull()
    expect(extractResourceId('https://drive.google.com/drive/folders/xyz')).toBe('xyz')
  })
})

describe('resourceTypeFromMime', () => {
  it('classifies folders, documents and everything else', () => {
    expect(resourceTypeFromMime(FOLDER_MIME)).toBe('folder')
    expect(resourceTypeFromMime(DOCUMENT_MIME)).toBe('document')
    expect(resourceTypeFromMime('application/pdf')).toBe('other')
    expect(resourceTypeFromMime('application/vnd.google-apps.spreadsheet')).toBe('other')
  })
})
