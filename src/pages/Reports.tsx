import { exportUrl } from '../api.ts'
import { useApi } from '../hooks.ts'
import { Card, Empty, ErrorState, Loading } from '../components/ui/States.tsx'

type MigrationReport = {
  totalDocuments: number
  statusCounts: Record<string, number>
  byCriterion: { criterion: string; documents: number; approved: number; completeness: number }[]
  bySubCriterion: { subCriterion: string; documents: number; approved: number }[]
  completenessPercent: number
  validationWarnings: number
  validationFailures: number
  approvedCount: number
  failedCount: number
  startedAt: string | null
  completedAt: string | null
}

type Activity = {
  entries: {
    id: string
    action: string
    entityType: string | null
    result: string
    summary: string | null
    errorRef: string | null
    utc: string
    singapore: string
  }[]
}

export default function Reports() {
  const report = useApi<MigrationReport>('/reports/migration')
  const activity = useApi<Activity>('/activity?limit=200')

  if (report.loading || activity.loading) return <Loading />
  if (report.error) return <ErrorState message={report.error} onRetry={report.reload} />

  const r = report.data

  return (
    <>
      <h1>Reports and Activity</h1>

      <Card title="Export">
        <div className="button-row">
          <a className="button-link" href={exportUrl('migration', 'csv')}>
            CSV summary
          </a>
          <a className="button-link" href={exportUrl('migration', 'json')}>
            JSON full record
          </a>
          <a className="button-link" href={exportUrl('migration', 'html')} target="_blank" rel="noreferrer">
            Printable HTML
          </a>
          <a className="button-link" href={exportUrl('activity', 'csv')}>
            Activity CSV
          </a>
        </div>
        {/* PDF is deliberately not offered — see the plan. Printing the HTML
            page from the browser produces a PDF without putting Chromium on a
            1.9 GiB box shared with four other applications. */}
        <p className="empty">
          For a PDF, open the printable HTML report and print it to PDF from your browser.
        </p>
      </Card>

      <Card title="Migration report">
        {!r || r.totalDocuments === 0 ? (
          <Empty>No documents have been scanned yet.</Empty>
        ) : (
          <>
            <div className="stat-grid">
              {[
                ['Total documents', r.totalDocuments],
                ['Approved', r.approvedCount],
                ['Failed', r.failedCount],
                ['Completeness %', r.completenessPercent],
                ['Validation warnings', r.validationWarnings],
                ['Validation failures', r.validationFailures],
              ].map(([label, value]) => (
                <div className="stat" key={String(label)}>
                  <span className="stat-value">{value}</span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </div>

            <h3>By criterion</h3>
            <table>
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Documents</th>
                  <th>Approved</th>
                  <th>Completeness</th>
                </tr>
              </thead>
              <tbody>
                {r.byCriterion.map((row) => (
                  <tr key={row.criterion}>
                    <td>{row.criterion}</td>
                    <td>{row.documents}</td>
                    <td>{row.approved}</td>
                    <td>{row.completeness}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>By sub-criterion</h3>
            {r.bySubCriterion.length === 0 ? (
              <Empty>No sub-criteria have documents yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Sub-criterion</th>
                    <th>Documents</th>
                    <th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySubCriterion.map((row) => (
                    <tr key={row.subCriterion}>
                      <td>{row.subCriterion}</td>
                      <td>{row.documents}</td>
                      <td>{row.approved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="empty">
              Started: {r.startedAt ? new Date(r.startedAt).toLocaleString('en-GB') : '—'} · Completed:{' '}
              {r.completedAt ? new Date(r.completedAt).toLocaleString('en-GB') : '—'}
            </p>
          </>
        )}
      </Card>

      <Card title="Activity log">
        {!activity.data?.entries.length ? (
          <Empty>No activity recorded yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Asia/Singapore</th>
                <th>UTC</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Result</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{e.singapore}</td>
                  <td className="nowrap">{e.utc}</td>
                  <td>{e.action}</td>
                  <td>{e.entityType ?? '—'}</td>
                  <td>{e.result}</td>
                  <td>
                    {e.summary}
                    {e.errorRef ? <div className="error-ref">Reference: {e.errorRef}</div> : null}
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
