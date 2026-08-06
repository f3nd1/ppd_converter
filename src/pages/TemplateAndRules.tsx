import { useState } from 'react'
import { api } from '../api.ts'
import { useApi } from '../hooks.ts'
import { Card, Empty, ErrorState, Loading, Pill } from '../components/ui/States.tsx'

type TemplateVersion = {
  id: string
  name: string
  googleDocId: string
  url: string
  versionLabel: string
  isActive: boolean
  activatedAt: string | null
  createdAt: string
}
type InstructionVersion = {
  id: string
  versionLabel: string
  body: string
  isActive: boolean
  createdAt: string
}
type MappingRule = {
  id: string
  oldSectionName: string
  newTargetSection: string
  transformationRule: string
  priority: number
  isActive: boolean
}
type MappingVersion = {
  id: string
  versionLabel: string
  approvalStatus: string
  isActive: boolean
  notes: string | null
  rules: MappingRule[]
}

type Tab = 'template' | 'instructions' | 'mapping'

export default function TemplateAndRules() {
  const [tab, setTab] = useState<Tab>('template')
  return (
    <>
      <h1>Template and AI Rules</h1>
      <div className="tabs" role="tablist">
        {(
          [
            ['template', 'Template'],
            ['instructions', 'AI Instructions'],
            ['mapping', 'Section Mapping'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'template' ? <TemplateTab /> : null}
      {tab === 'instructions' ? <InstructionsTab /> : null}
      {tab === 'mapping' ? <MappingTab /> : null}
    </>
  )
}

function TemplateTab() {
  const { data, error, loading, reload } = useApi<{
    versions: TemplateVersion[]
    defaultTargetSections: string[]
  }>('/template/versions')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('v1')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const active = data?.versions.find((v) => v.isActive) ?? null

  const validate = async () => {
    setBusy(true)
    setProblem(null)
    setResult(null)
    try {
      const res = await api.post<Record<string, unknown>>('/template/validate', {
        url,
        versionLabel: label,
      })
      setResult(res)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const activate = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api.post('/template/activate', { url, versionLabel: label, validationResult: result })
      setResult(null)
      reload()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card title="Approved Google Docs template">
        {/* A Google Docs URL, never a file upload — the live template must be a Doc. */}
        <label>
          Google Docs template link
          <input
            aria-label="Google Docs template link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
          />
        </label>
        <label className="narrow">
          Version label
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" disabled={busy || !url.trim()} onClick={validate}>
            Validate
          </button>
          <button
            type="button"
            disabled={busy || result?.valid !== true}
            onClick={activate}
            title={result?.valid !== true ? 'Validate the template first' : undefined}
          >
            Save as active template
          </button>
          {url.trim() ? (
            <a className="button-link" href={url} target="_blank" rel="noreferrer">
              Open in Google Docs
            </a>
          ) : null}
        </div>

        {problem ? <ErrorState message={problem} /> : null}

        {result ? (
          <div className="preview">
            <h3>Preview</h3>
            <p>
              {result.valid === true ? (
                <Pill kind="ok">Valid</Pill>
              ) : (
                <Pill kind="bad">Not valid</Pill>
              )}{' '}
              {String(result.title ?? '')}
            </p>
            {Array.isArray(result.problems) && result.problems.length > 0 ? (
              <ul>
                {(result.problems as string[]).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="Target structure">
        <p className="empty">
          Configurable, because the approved template is still being finalised. These sections are
          the current default and are frozen into each template version when it is activated.
        </p>
        <ul>
          {(data?.defaultTargetSections ?? []).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>

      <Card title="Template version history">
        {!data?.versions.length ? (
          <Empty>No template has been configured yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Name</th>
                <th>Status</th>
                <th>Activated</th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.versionLabel}</td>
                  <td>
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {v.name}
                    </a>
                  </td>
                  <td>{v.isActive ? <Pill kind="ok">Active</Pill> : <Pill kind="muted">Inactive</Pill>}</td>
                  <td>{v.activatedAt ? new Date(v.activatedAt).toLocaleString('en-GB') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {active ? <p className="empty">Only one template may be active at a time.</p> : null}
      </Card>
    </>
  )
}

function InstructionsTab() {
  const { data, error, loading, reload } = useApi<{ versions: InstructionVersion[] }>(
    '/ai-instructions',
  )
  const [body, setBody] = useState('')
  const [label, setLabel] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const active = data?.versions.find((v) => v.isActive)

  const run = async (fn: () => Promise<unknown>) => {
    setProblem(null)
    try {
      await fn()
      reload()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Card title="Active AI instructions">
        {active ? (
          <>
            <p>
              <Pill kind="ok">{active.versionLabel}</Pill>
            </p>
            <pre className="instructions">{active.body}</pre>
          </>
        ) : (
          <Empty>No instruction version is active.</Empty>
        )}
      </Card>

      <Card title="Save a new version">
        <label>
          Version label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="v2" />
        </label>
        <label>
          Instructions
          <textarea
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={active?.body ?? ''}
          />
        </label>
        <button
          type="button"
          disabled={!label.trim() || !body.trim()}
          onClick={() =>
            run(async () => {
              await api.post('/ai-instructions', { versionLabel: label, body })
              setLabel('')
              setBody('')
            })
          }
        >
          Save new version
        </button>
        {problem ? <ErrorState message={problem} /> : null}
      </Card>

      <Card title="Version history">
        {!data?.versions.length ? (
          <Empty>No versions yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.versionLabel}</td>
                  <td>{v.isActive ? <Pill kind="ok">Active</Pill> : <Pill kind="muted">—</Pill>}</td>
                  <td>{new Date(v.createdAt).toLocaleString('en-GB')}</td>
                  <td>
                    {!v.isActive ? (
                      <button
                        type="button"
                        onClick={() => run(() => api.post(`/ai-instructions/${v.id}/activate`))}
                      >
                        Activate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => run(() => api.post(`/ai-instructions/${v.id}/restore`))}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}

function MappingTab() {
  const { data, error, loading, reload } = useApi<{ versions: MappingVersion[] }>('/mapping-versions')
  const [label, setLabel] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const run = async (fn: () => Promise<unknown>) => {
    setProblem(null)
    try {
      await fn()
      reload()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    }
  }

  const approvedActive = data?.versions.find(
    (v) => v.isActive && v.approvalStatus === 'approved',
  )

  return (
    <>
      {!approvedActive ? (
        <p className="blocked" role="status">
          Migration is blocked: no approved active mapping version exists.
        </p>
      ) : null}

      <Card title="Create a mapping version">
        {/* No mappings are assumed or pre-filled — the approved mapping has not
            been supplied, and inventing one is explicitly forbidden. */}
        <p className="empty">
          No mapping rules are created automatically. Every rule is entered and approved by you.
        </p>
        <label className="narrow">
          Version label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="v1" />
        </label>
        <button
          type="button"
          disabled={!label.trim()}
          onClick={() =>
            run(async () => {
              await api.post('/mapping-versions', { versionLabel: label })
              setLabel('')
            })
          }
        >
          Create version
        </button>
        {problem ? <ErrorState message={problem} /> : null}
      </Card>

      {!data?.versions.length ? (
        <Card>
          <Empty>No mapping versions yet.</Empty>
        </Card>
      ) : (
        data.versions.map((version) => (
          <MappingVersionCard key={version.id} version={version} onChange={reload} run={run} />
        ))
      )}
    </>
  )
}

function MappingVersionCard({
  version,
  onChange,
  run,
}: {
  version: MappingVersion
  onChange: () => void
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [rule, setRule] = useState({
    oldSectionName: '',
    newTargetSection: '',
    transformationRule: '',
    priority: 100,
  })
  const locked = version.approvalStatus === 'approved'

  return (
    <Card title={`Mapping ${version.versionLabel}`}>
      <p>
        <Pill kind={version.approvalStatus === 'approved' ? 'ok' : 'muted'}>
          {version.approvalStatus}
        </Pill>{' '}
        {version.isActive ? <Pill kind="ok">Active</Pill> : null}
      </p>

      {version.rules.length === 0 ? (
        <Empty>No rules in this version.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Old section</th>
              <th>New target section</th>
              <th>Transformation</th>
              <th>Priority</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {version.rules.map((r) => (
              <tr key={r.id}>
                <td>{r.oldSectionName}</td>
                <td>{r.newTargetSection}</td>
                <td>{r.transformationRule}</td>
                <td>{r.priority}</td>
                <td>
                  {!locked ? (
                    <button type="button" onClick={() => run(() => api.del(`/mapping-rules/${r.id}`))}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!locked ? (
        <div className="add-rule">
          <input
            aria-label="Old section name"
            placeholder="Old section name"
            value={rule.oldSectionName}
            onChange={(e) => setRule({ ...rule, oldSectionName: e.target.value })}
          />
          <input
            aria-label="New target section"
            placeholder="New target section"
            value={rule.newTargetSection}
            onChange={(e) => setRule({ ...rule, newTargetSection: e.target.value })}
          />
          <input
            aria-label="Transformation rule"
            placeholder="Transformation rule"
            value={rule.transformationRule}
            onChange={(e) => setRule({ ...rule, transformationRule: e.target.value })}
          />
          <button
            type="button"
            disabled={
              !rule.oldSectionName.trim() ||
              !rule.newTargetSection.trim() ||
              !rule.transformationRule.trim()
            }
            onClick={() =>
              run(async () => {
                await api.post('/mapping-rules', { mappingVersionId: version.id, ...rule })
                setRule({ oldSectionName: '', newTargetSection: '', transformationRule: '', priority: 100 })
                onChange()
              })
            }
          >
            Add rule
          </button>
        </div>
      ) : (
        <p className="empty">Approved versions cannot be edited. Create a new version to change rules.</p>
      )}

      <div className="button-row">
        {version.approvalStatus !== 'approved' ? (
          <button
            type="button"
            disabled={version.rules.length === 0}
            title={version.rules.length === 0 ? 'Add at least one rule first' : undefined}
            onClick={() => run(() => api.post(`/mapping-versions/${version.id}/approve`))}
          >
            Approve
          </button>
        ) : null}
        {version.approvalStatus === 'approved' && !version.isActive ? (
          <button
            type="button"
            onClick={() => run(() => api.post(`/mapping-versions/${version.id}/activate`))}
          >
            Activate
          </button>
        ) : null}
      </div>
    </Card>
  )
}
