import { useApi } from '../hooks.ts'
import { Card, Empty, ErrorState, Loading, Pill } from '../components/ui/States.tsx'

// Every figure here is read live from the server. Nothing is hardcoded — the
// brief forbids hardcoded production statistics, so an empty database shows
// zeros and honest empty states rather than plausible-looking numbers.

type DashboardData = {
  totals: { sourceDocuments: number; criteria: number; subCriteria: number }
  status: {
    notStarted: number
    queued: number
    processing: number
    migrated: number
    awaitingReview: number
    approved: number
    failed: number
  }
  validationIssues: number
  progressPercent: number
  activeTemplate: { id: string; name: string; versionLabel: string; url: string } | null
  activeAIInstruction: { id: string; versionLabel: string } | null
  activeMapping: { id: string; versionLabel: string; approvalStatus: string } | null
  recentActivity: {
    id: string
    action: string
    summary: string | null
    result: string
    singapore: string
  }[]
}

export default function Dashboard() {
  const { data, error, correlationId, loading, reload } = useApi<DashboardData>('/dashboard')

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={reload} />
  if (!data) return <Empty>No data.</Empty>

  const stats: [string, number][] = [
    ['Source documents', data.totals.sourceDocuments],
    ['Criteria', data.totals.criteria],
    ['Sub-criteria', data.totals.subCriteria],
    ['Not started', data.status.notStarted],
    ['Queued', data.status.queued],
    ['Processing', data.status.processing],
    ['Migrated', data.status.migrated],
    ['Awaiting review', data.status.awaitingReview],
    ['Approved', data.status.approved],
    ['Failed', data.status.failed],
    ['Validation issues', data.validationIssues],
  ]

  return (
    <>
      <h1>Dashboard</h1>

      <div className="stat-grid">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </div>
        ))}
      </div>

      <Card title="Overall migration progress">
        <div className="bar" role="img" aria-label={`${data.progressPercent}% complete`}>
          <div className="bar-fill" style={{ width: `${data.progressPercent}%` }} />
        </div>
        <p className="empty">{data.progressPercent}% of source documents approved or exported.</p>
      </Card>

      <Card title="Active configuration">
        <dl className="config-list">
          <dt>Google Docs template</dt>
          <dd>
            {data.activeTemplate ? (
              <>
                {data.activeTemplate.name} <Pill kind="ok">{data.activeTemplate.versionLabel}</Pill>{' '}
                <a href={data.activeTemplate.url} target="_blank" rel="noreferrer">
                  Open in Google Docs
                </a>
              </>
            ) : (
              <Pill kind="warn">None configured</Pill>
            )}
          </dd>

          <dt>AI instruction version</dt>
          <dd>
            {data.activeAIInstruction ? (
              <Pill kind="ok">{data.activeAIInstruction.versionLabel}</Pill>
            ) : (
              <Pill kind="warn">None active</Pill>
            )}
          </dd>

          <dt>Section mapping</dt>
          <dd>
            {data.activeMapping ? (
              <Pill kind="ok">
                {data.activeMapping.versionLabel} · {data.activeMapping.approvalStatus}
              </Pill>
            ) : (
              <Pill kind="warn">No approved active mapping — migration is blocked</Pill>
            )}
          </dd>
        </dl>
      </Card>

      <Card title="Recent activity">
        {data.recentActivity.length === 0 ? (
          <Empty>Nothing has happened yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When (Asia/Singapore)</th>
                <th>Action</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.recentActivity.map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap">{entry.singapore}</td>
                  <td>{entry.action}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
