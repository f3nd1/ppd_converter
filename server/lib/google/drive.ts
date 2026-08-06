import { DOCUMENT_MIME, FOLDER_MIME } from './urls.ts'

// Drive v3 over plain fetch rather than the `googleapis` package. The package
// loads a full API index and costs far more memory than the handful of calls
// this app makes — on a 1.9 GiB box shared with four other apps that mattered.

const DRIVE = 'https://www.googleapis.com/drive/v3'

// Bounds copied in spirit from gd4_simulator, which hit real folders: without
// them a mis-pasted link to "My Drive" would walk the entire drive.
const MAX_PAGES = 10
const MAX_DEPTH = 5

export class DriveError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink?: string
  parents?: string[]
}

/** Injectable so tests never touch the network and production never mocks. */
export type Fetcher = typeof fetch

export type DriveClient = ReturnType<typeof makeDriveClient>

export function makeDriveClient(accessToken: string, fetchImpl: Fetcher = fetch) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${DRIVE}${path}`, {
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
        /* keep the raw text */
      }
      throw new DriveError(detail || `Drive request failed (${res.status})`, res.status)
    }
    return (await res.json()) as T
  }

  return {
    async getFile(fileId: string): Promise<DriveFile> {
      return call<DriveFile>(
        `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink,parents&supportsAllDrives=true`,
      )
    },

    /** Google Docs directly inside a folder. Not recursive by default. */
    async listDocsInFolder(folderId: string, recursive = false): Promise<DriveFile[]> {
      const collected: DriveFile[] = []

      const walk = async (parent: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH) return
        let pageToken: string | undefined
        let pages = 0

        do {
          // URLSearchParams handles the escaping; encoding q by hand as well
          // would double-encode it and silently return zero files.
          const params = new URLSearchParams({
            q: `'${parent}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
            pageSize: '100',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
          })
          if (pageToken) params.set('pageToken', pageToken)

          const page = await call<{ nextPageToken?: string; files?: DriveFile[] }>(
            `/files?${params.toString()}`,
          )

          for (const file of page.files ?? []) {
            if (file.mimeType === DOCUMENT_MIME) collected.push(file)
            else if (recursive && file.mimeType === FOLDER_MIME) await walk(file.id, depth + 1)
          }
          pageToken = page.nextPageToken
          pages += 1
        } while (pageToken && pages < MAX_PAGES)
      }

      await walk(folderId, 0)
      return collected
    },

    /** Copy a file (used only for the approved template) into a folder. */
    async copyFile(fileId: string, name: string, parentFolderId: string): Promise<DriveFile> {
      return call<DriveFile>(
        `/files/${encodeURIComponent(fileId)}/copy?fields=id,name,mimeType,modifiedTime,webViewLink&supportsAllDrives=true`,
        { method: 'POST', body: JSON.stringify({ name, parents: [parentFolderId] }) },
      )
    },

    /**
     * Used before creating a revised document, so an existing target is found
     * and reported rather than silently duplicated.
     */
    async findByNameInFolder(folderId: string, name: string): Promise<DriveFile | null> {
      // Escaping is for Drive's own query language, not for the URL — a title
      // containing an apostrophe would otherwise break the query.
      const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and name = '${escaped}' and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      const page = await call<{ files?: DriveFile[] }>(`/files?${params.toString()}`)
      return page.files?.[0] ?? null
    },
  }
}
