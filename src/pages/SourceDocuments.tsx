import { useState } from 'react'
import { api } from '../api.ts'
import { useApi } from '../hooks.ts'
import { Empty, ErrorState, Loading, Pill } from '../components/ui/States.tsx'

// Seven criteria, each expandable. Sub-criterion names are entered by the
// operator — none are invented here, and none are seeded.

type SourceMapping = {
  id: string
  oldUrl: string | null
  newUrl: string | null
  oldResourceType: string | null
  newResourceType: string | null
  validationStatus: string
  errorDetail: string | null
  lastScannedAt: string | null
  sourceDocCount: number
}

type SubCriterion = {
  id: string
  code: string
  title: string
  order: number
  isActive: boolean
  sourceMapping: SourceMapping | null
}

type Criterion = { id: string; number: number; title: string; subCriteria: SubCriterion[] }

export default function SourceDocuments() {
  const { data, error, correlationId, loading, reload } =
    useApi<{ criteria: Criterion[] }>('/criteria')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Expansion is React state rather than the DOM's own <details> open flag:
  // any action here reloads the criteria, and an uncontrolled <details> snaps
  // shut on re-render, collapsing the section the user is working in.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={reload} />

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setMessage(null)
    try {
      await fn()
      reload()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1>Source Documents</h1>
      <p className="empty">
        Add a sub-criterion under each criterion, then set its old and new Google links.
      </p>
      {message ? <ErrorState message={message} /> : null}

      <ul className="criteria">
        {(data?.criteria ?? []).map((criterion) => (
          <li key={criterion.id}>
            <details
              open={expanded.has(criterion.id)}
              onToggle={(e) => {
                const next = new Set(expanded)
                if (e.currentTarget.open) next.add(criterion.id)
                else next.delete(criterion.id)
                setExpanded(next)
              }}
            >
              <summary>
                Criterion {criterion.number}{' '}
                <span className="count">({criterion.subCriteria.length})</span>
              </summary>

              <div className="criterion-body">
                {criterion.subCriteria.length === 0 ? (
                  <Empty>No sub-criteria added yet.</Empty>
                ) : (
                  criterion.subCriteria.map((sub) => (
                    <SubCriterionRow
                      key={sub.id}
                      sub={sub}
                      busy={busy}
                      onAct={act}
                    />
                  ))
                )}
                <AddSubCriterion criterionId={criterion.id} onAdded={reload} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  )
}

function SubCriterionRow({
  sub,
  busy,
  onAct,
}: {
  sub: SubCriterion
  busy: string | null
  onAct: (key: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [oldUrl, setOldUrl] = useState(sub.sourceMapping?.oldUrl ?? '')
  const [newUrl, setNewUrl] = useState(sub.sourceMapping?.newUrl ?? '')
  const mapping = sub.sourceMapping

  return (
    <div className={`sub-row${sub.isActive ? '' : ' inactive'}`} data-testid="sub-criterion-row">
      <div className="sub-head">
        <strong>
          {sub.code} {sub.title}
        </strong>
        {!sub.isActive ? <Pill kind="muted">Deactivated</Pill> : null}
        <span className="spacer" />
        <button type="button" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            onAct(`toggle-${sub.id}`, () =>
              api.patch(`/sub-criteria/${sub.id}`, { isActive: !sub.isActive }),
            )
          }
        >
          {sub.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      {/* The literal arrow is required by the brief and is asserted in tests. */}
      <div className="links" data-testid="link-row">
        <span className="link-side">
          {mapping?.oldUrl ? (
            <a href={mapping.oldUrl} target="_blank" rel="noreferrer">
              Old Google link
            </a>
          ) : (
            <span className="empty">No old link</span>
          )}
        </span>
        <span className="arrow" aria-label="maps to">
          →
        </span>
        <span className="link-side">
          {mapping?.newUrl ? (
            <a href={mapping.newUrl} target="_blank" rel="noreferrer">
              New Google link
            </a>
          ) : (
            <span className="empty">No new link</span>
          )}
        </span>
      </div>

      <div className="sub-meta">
        <Pill kind={mapping?.validationStatus === 'valid' ? 'ok' : mapping?.validationStatus === 'invalid' ? 'bad' : 'muted'}>
          {mapping?.validationStatus ?? 'not_validated'}
        </Pill>
        <span>{mapping?.sourceDocCount ?? 0} source document(s)</span>
        <span>
          Last scanned:{' '}
          {mapping?.lastScannedAt ? new Date(mapping.lastScannedAt).toLocaleString('en-GB') : 'never'}
        </span>
        <span className="spacer" />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            onAct(`validate-${sub.id}`, () =>
              api.post(`/source-mappings/${sub.id}/validate-links`),
            )
          }
        >
          Validate links
        </button>
        <button
          type="button"
          disabled={busy !== null || mapping?.validationStatus !== 'valid'}
          title={mapping?.validationStatus !== 'valid' ? 'Validate the links first' : undefined}
          onClick={() => onAct(`scan-${sub.id}`, () => api.post(`/source-mappings/${sub.id}/scan`))}
        >
          Scan source
        </button>
      </div>

      {mapping?.errorDetail ? <p className="error-detail">{mapping.errorDetail}</p> : null}

      {editing ? (
        <div className="edit-links">
          <label>
            Old Google link (folder or document)
            <input value={oldUrl} onChange={(e) => setOldUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
          </label>
          <label>
            New Google link (REVISED destination folder)
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
          </label>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              onAct(`links-${sub.id}`, async () => {
                await api.patch(`/source-mappings/${sub.id}/links`, { oldUrl, newUrl })
                setEditing(false)
              })
            }
          >
            Save links
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AddSubCriterion({ criterionId, onAdded }: { criterionId: string; onAdded: () => void }) {
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post('/sub-criteria', { criterionId, code, title })
      setCode('')
      setTitle('')
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-sub">
      <input
        aria-label="Sub-criterion code"
        placeholder="Code, e.g. 1.1.1"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <input
        aria-label="Sub-criterion title"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="button" disabled={saving || !code.trim() || !title.trim()} onClick={submit}>
        Add sub-criterion
      </button>
      {error ? <span className="error-detail">{error}</span> : null}
    </div>
  )
}
