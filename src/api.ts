// Single place the client talks to the server. Every call is same-origin under
// the base path, so no CORS and no configurable API host.

const BASE = '/ppd_converter/api'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; correlationId?: string }
    // The correlation id is surfaced to the user so a report of "it broke" can
    // be traced to a log line.
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.correlationId)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export function exportUrl(scope: 'migration' | 'activity', format: 'csv' | 'json' | 'html') {
  return `${BASE}/reports/export?scope=${scope}&format=${format}`
}
