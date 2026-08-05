// Phase 1 shell. The production template is configured by Google Docs URL only —
// never by file upload — and no content mapping is created until an approved
// mapping version exists.
export default function TemplateAndRules() {
  return (
    <>
      <h1>Template and AI Rules</h1>
      <p className="empty">
        Not configured yet. This page will hold the Google Docs template URL and its version history,
        the versioned AI instruction set, and the section mapping with its approval state.
      </p>
    </>
  )
}
