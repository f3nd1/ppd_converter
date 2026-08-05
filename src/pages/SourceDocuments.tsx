// Phase 1 shell. The seven criteria are rendered from their numbers only —
// official sub-criterion names are NOT invented here. Whether they get imported
// or typed in by hand is still an open decision (plan §21 O-3).
const CRITERIA = [1, 2, 3, 4, 5, 6, 7]

export default function SourceDocuments() {
  return (
    <>
      <h1>Source Documents</h1>
      <p className="empty">
        Sub-criteria are not configured yet. Each row will show{' '}
        <code>[Sub-criterion] [Old Google link] → [New Google link]</code>, with link validation and
        source scanning.
      </p>
      <ul className="criteria">
        {CRITERIA.map((n) => (
          <li key={n}>
            <details>
              <summary>Criterion {n}</summary>
              <p className="empty">No sub-criteria added yet.</p>
            </details>
          </li>
        ))}
      </ul>
    </>
  )
}
