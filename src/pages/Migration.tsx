import { useCallback, useState } from 'react'
import { api } from '../api.ts'
import { useApi, usePoll } from '../hooks.ts'
import { Card, Empty, ErrorState, Loading, Pill } from '../components/ui/States.tsx'

// Document selection, migration status, detailed changes, validation, review and
// approval — combined on one page as the brief requires.

type SourceDoc = {
  id: string
  title: string
  migrationStatus: string
  webViewLink: string | null
  sourceMapping: {
    newUrl: string | null
    subCriterion: { code: string; title: string; criterion: { number: number } }
  }
  migratedDocuments: { id: string; targetTitle: string; targetUrl: string | null }[]
}

type Job = {
  id: string
  stage: string
  attempt: number
  errorMessage: string | null
  sourceDocument: { id: string; title: string }
  migratedDocument: { id: string; targetTitle: string; targetUrl: string | null } | null
}

const ACTIVE_STAGES = new Set([
  'queued',
  'reading_source',
  'parsing_structure',
  'mapping_content',
  'generating_content',
  'copying_template',
  'writing_target',
  'validating',
])

export default function Migration() {
  const readiness = useApi<{ allowed: boolean; blockers: string[] }>('/migration/readiness')
  const docs = useApi<{ documents: SourceDoc[] }>('/source-documents')
  const status = useApi<{ jobs: Job[]; running: boolean }>('/migration/status')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [filter, setFilter] = useState({ criterion: '', status: '', title: '' })

  // Polling rather than SSE: one user, one job at a time, and it keeps the
  // nginx block free of buffering directives (plan §1a).
  const anyActive = (status.data?.jobs ?? []).some((j) => ACTIVE_STAGES.has(j.stage))
  const refresh = useCallback(() => {
    status.reload()
    docs.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  usePoll(refresh, 2000, anyActive || Boolean(status.data?.running))

  if (readiness.loading || docs.loading) return <Loading />
  if (docs.error) return <ErrorState message={docs.error} onRetry={docs.reload} />

  const blocked = readiness.data ? !readiness.data.allowed : true
  const documents = (docs.data?.documents ?? []).filter(
    (d) =>
      (!filter.criterion || String(d.sourceMapping.subCriterion.criterion.number) === filter.criterion) &&
      (!filter.status || d.migrationStatus === filter.status) &&
      (!filter.title || d.title.toLowerCase().includes(filter.title.toLowerCase())),
  )

  const queue = async (ids: string[]) => {
    setProblem(null)
    try {
      await api.post('/migration/queue', { sourceDocumentIds: ids })
      setSelected(new Set())
      refresh()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <h1>Migration and Validation</h1>

      {blocked ? (
        <p className="blocked" role="status">
          {readiness.data?.blockers.join(' ') ??
            'Migration is blocked: no approved active mapping version exists.'}
        </p>
      ) : null}
      {problem ? <ErrorState message={problem} /> : null}

      <Card title="Document selection">
        <div className="filters">
          <select
            aria-label="Filter by criterion"
            value={filter.criterion}
            onChange={(e) => setFilter({ ...filter, criterion: e.target.value })}
          >
            <option value="">All criteria</option>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                Criterion {n}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {['not_started', 'queued', 'awaiting_review', 'approved', 'failed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            aria-label="Filter by document title"
            placeholder="Document title"
            value={filter.title}
            onChange={(e) => setFilter({ ...filter, title: e.target.value })}
          />
        </div>

        {documents.length === 0 ? (
          <Empty>No source documents. Scan a source folder first.</Empty>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Document</th>
                  <th>Criterion</th>
                  <th>Sub-criterion</th>
                  <th>Old link</th>
                  <th>Destination</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${d.title}`}
                        checked={selected.has(d.id)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(d.id)
                          else next.delete(d.id)
                          setSelected(next)
                        }}
                      />
                    </td>
                    <td>{d.title}</td>
                    <td>Criterion {d.sourceMapping.subCriterion.criterion.number}</td>
                    <td>{d.sourceMapping.subCriterion.code}</td>
                    <td>
                      {d.webViewLink ? (
                        <a href={d.webViewLink} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {d.sourceMapping.newUrl ? (
                        <a href={d.sourceMapping.newUrl} target="_blank" rel="noreferrer">
                          REVISED folder
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Pill kind={d.migrationStatus === 'failed' ? 'bad' : d.migrationStatus === 'approved' ? 'ok' : 'muted'}>
                        {d.migrationStatus}
                      </Pill>
                      {d.migratedDocuments[0] ? (
                        <button type="button" onClick={() => setOpenDoc(d.migratedDocuments[0]!.id)}>
                          Review
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="button-row">
              <button
                type="button"
                disabled={blocked || selected.size === 0}
                title={blocked ? 'Migration is blocked without an approved mapping' : undefined}
                onClick={() => queue([...selected])}
              >
                Migrate selected ({selected.size})
              </button>
            </div>
          </>
        )}
      </Card>

      <Card title="Migration status">
        {!status.data?.jobs.length ? (
          <Empty>No migrations have been queued.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Stage</th>
                <th>Attempt</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {status.data.jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.sourceDocument.title}</td>
                  <td>
                    <Pill kind={job.stage === 'failed' ? 'bad' : job.stage === 'approved' ? 'ok' : 'muted'}>
                      {job.stage}
                    </Pill>
                  </td>
                  <td>{job.attempt}</td>
                  <td>
                    {job.errorMessage ? <span className="error-detail">{job.errorMessage}</span> : null}
                    {job.migratedDocument ? (
                      <button type="button" onClick={() => setOpenDoc(job.migratedDocument!.id)}>
                        Open review
                      </button>
                    ) : null}
                    {job.stage === 'failed' ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.post(`/migration/${job.id}/retry`)
                          refresh()
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {openDoc ? <ReviewPanel id={openDoc} onClose={() => setOpenDoc(null)} onChanged={refresh} /> : null}
    </>
  )
}

type ReviewData = {
  document: {
    id: string
    targetTitle: string
    targetUrl: string | null
    outputVersion: string
    status: string
    sourceDocument: { title: string; webViewLink: string | null }
    changes: {
      id: string
      changeNumber: number
      changeType: string
      sourceSection: string | null
      targetSection: string | null
      sourceBlockId: string | null
      originalExcerpt: string | null
      revisedExcerpt: string | null
      reason: string | null
      confidence: number | null
    }[]
    validationRuns: {
      id: string
      layer: string
      summary: string | null
      items: {
        id: string
        category: string
        checkPerformed: string
        result: string
        details: string | null
        severity: string
        resolutionStatus: string
      }[]
    }[]
  }
  gate: { canApprove: boolean; blockers: string[] }
}

function ReviewPanel({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const { data, error, loading, reload } = useApi<ReviewData>(`/migrated-documents/${id}`)
  const [problem, setProblem] = useState<string | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const doc = data.document
  const run = async (fn: () => Promise<unknown>) => {
    setProblem(null)
    try {
      await fn()
      reload()
      onChanged()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card title={`Review — ${doc.targetTitle}`}>
      <div className="button-row">
        {doc.sourceDocument.webViewLink ? (
          <a className="button-link" href={doc.sourceDocument.webViewLink} target="_blank" rel="noreferrer">
            Open source Google Doc
          </a>
        ) : null}
        {doc.targetUrl ? (
          <a className="button-link" href={doc.targetUrl} target="_blank" rel="noreferrer">
            Open revised Google Doc
          </a>
        ) : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {problem ? <ErrorState message={problem} /> : null}

      <h3>Detailed changes ({doc.changes.length})</h3>
      {doc.changes.length === 0 ? (
        <Empty>No changes recorded.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Target section</th>
              <th>Original excerpt</th>
              <th>Revised excerpt</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {doc.changes.map((c) => (
              <tr key={c.id}>
                <td>{c.changeNumber}</td>
                <td>{c.changeType}</td>
                <td>{c.targetSection ?? '—'}</td>
                <td className="excerpt">{c.originalExcerpt ?? '—'}</td>
                <td className="excerpt">{c.revisedExcerpt ?? '—'}</td>
                <td>{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {doc.validationRuns.map((vrun) => (
        <div key={vrun.id}>
          <h3>
            {vrun.layer === 'deterministic' ? 'Deterministic validation' : 'AI-assisted validation'}{' '}
            <span className="empty">{vrun.summary}</span>
          </h3>
          {vrun.items.length === 0 ? (
            <Empty>No items.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Result</th>
                  <th>Details</th>
                  <th>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {vrun.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.checkPerformed}</td>
                    <td>
                      <Pill kind={item.result === 'fail' ? 'bad' : item.result === 'warning' ? 'warn' : 'ok'}>
                        {item.result}
                      </Pill>
                    </td>
                    <td>{item.details}</td>
                    <td>
                      {item.resolutionStatus === 'open' && item.result !== 'pass' ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              run(() =>
                                api.post(`/validation-items/${item.id}/resolve`, {
                                  resolutionStatus: 'acknowledged',
                                }),
                              )
                            }
                          >
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const note = window.prompt('Justification for marking a false positive:')
                              if (!note) return
                              void run(() =>
                                api.post(`/validation-items/${item.id}/resolve`, {
                                  resolutionStatus: 'false_positive',
                                  resolutionNote: note,
                                }),
                              )
                            }}
                          >
                            False positive
                          </button>
                        </>
                      ) : (
                        <Pill kind="muted">{item.resolutionStatus}</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      <h3>Decision</h3>
      {!data.gate.canApprove ? (
        <p className="blocked" role="status">
          {data.gate.blockers.join(' ')}
        </p>
      ) : null}
      <div className="button-row">
        <button
          type="button"
          disabled={!data.gate.canApprove || doc.status === 'approved'}
          title={!data.gate.canApprove ? data.gate.blockers.join(' ') : undefined}
          onClick={() => run(() => api.post(`/review/${doc.id}/decision`, { decision: 'approved' }))}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            const comment = window.prompt('What needs correcting?') ?? undefined
            void run(() =>
              api.post(`/review/${doc.id}/decision`, {
                decision: 'returned_for_correction',
                comment,
              }),
            )
          }}
        >
          Return for correction
        </button>
      </div>
    </Card>
  )
}
