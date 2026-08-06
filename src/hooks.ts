import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from './api.ts'

export type Async<T> = {
  data: T | null
  error: string | null
  correlationId?: string
  loading: boolean
  reload: () => void
}

/**
 * Fetch-on-mount with a manual reload. Deliberately not a data-fetching
 * library: this app is single-user with a handful of screens, and a cache layer
 * would be more moving parts than the problem needs.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correlationId, setCorrelationId] = useState<string | undefined>()
  const [loading, setLoading] = useState(Boolean(path))
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .get<T>(path)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
        setCorrelationId(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setCorrelationId(err instanceof ApiError ? err.correlationId : undefined)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, error, correlationId, loading, reload }
}

/** Polls while `active` is true. Used for migration progress — see plan §1a. */
export function usePoll(callback: () => void, intervalMs: number, active: boolean) {
  useEffect(() => {
    if (!active) return
    const id = setInterval(callback, intervalMs)
    return () => clearInterval(id)
  }, [callback, intervalMs, active])
}
