// Phase 1 shell. Migration stays disabled until an approved active mapping
// version exists — enforced server-side, not by this page's controls.
export default function Migration() {
  return (
    <>
      <h1>Migration and Validation</h1>
      <p className="empty">
        No documents available yet. Document selection, migration stages, the detailed change record,
        both validation layers and the approval gate appear here.
      </p>
      <p className="blocked">
        Migration is blocked: no approved active mapping version exists.
      </p>
    </>
  )
}
