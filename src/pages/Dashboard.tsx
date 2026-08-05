// Phase 1 shell. Every figure on this page will be read live from SQLite in a
// later phase — the brief forbids hardcoded production statistics, so this shell
// deliberately shows no numbers at all rather than plausible-looking placeholders.
export default function Dashboard() {
  return (
    <>
      <h1>Dashboard</h1>
      <p className="empty">
        Not yet connected to data. Counts, migration progress, the active template, the active AI
        instruction version and recent activity appear here once the data layer is in place.
      </p>
    </>
  )
}
