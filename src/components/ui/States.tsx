import type { ReactNode } from 'react'

// Empty and error states are first-class here rather than an afterthought — the
// brief tests both, and "nothing configured yet" is the normal state of most of
// this app until an operator fills it in.

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function ErrorState({
  message,
  correlationId,
  onRetry,
}: {
  message: string
  correlationId?: string
  onRetry?: () => void
}) {
  return (
    <div className="error" role="alert">
      <strong>Something went wrong.</strong> {message}
      {correlationId ? (
        <div className="error-ref">
          Reference: <code>{correlationId}</code> — quote this if you report the problem.
        </div>
      ) : null}
      {onRetry ? (
        <div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function Blocked({ children }: { children: ReactNode }) {
  return (
    <p className="blocked" role="status">
      {children}
    </p>
  )
}

export function Loading() {
  return <p className="empty">Loading…</p>
}

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`pill pill-${kind}`}>{children}</span>
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  )
}
