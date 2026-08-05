// The five primary navigation areas. This list is the single source of truth —
// the sidebar and the router both derive from it, so a page can never exist
// without a nav entry or vice versa.
export type NavItem = { path: string; label: string; hint: string }

export const NAV: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    hint: 'Live counts, active template, active AI instruction version, recent activity',
  },
  {
    path: '/source-documents',
    label: 'Source Documents',
    hint: 'Seven criteria, sub-criteria, old and new Google links, link validation and source scans',
  },
  {
    path: '/template-and-rules',
    label: 'Template and AI Rules',
    hint: 'Google Docs template, AI instruction versions, section mapping and approval',
  },
  {
    path: '/migration',
    label: 'Migration and Validation',
    hint: 'Select documents, run migrations, review changes, validation and approval',
  },
  {
    path: '/reports',
    label: 'Reports and Activity',
    hint: 'Migration and document reports, exports, and the activity log',
  },
]
