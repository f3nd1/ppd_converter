// The five primary navigation areas. This list is the single source of truth —
// the sidebar, the top bar's title and the router all derive from it, so a page
// can never exist without a nav entry or vice versa.
//
// `group` is a visual heading only, matching the approved prototype's sidebar
// treatment. It does not add a navigation area: there are still exactly five.
export type NavItem = { path: string; label: string; hint: string; group: string }

export const NAV: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    hint: 'Live counts, active template, active AI instruction version, recent activity',
    group: 'Overview',
  },
  {
    path: '/source-documents',
    label: 'Source Documents',
    hint: 'Seven criteria, sub-criteria, old and new Google links, link validation and source scans',
    group: 'Configure',
  },
  {
    path: '/template-and-rules',
    label: 'Template and AI Rules',
    hint: 'Google Docs template, AI instruction versions, section mapping and approval',
    group: 'Configure',
  },
  {
    path: '/migration',
    label: 'Migration and Validation',
    hint: 'Select documents, run migrations, review changes, validation and approval',
    group: 'Run and review',
  },
  {
    path: '/reports',
    label: 'Reports and Activity',
    hint: 'Migration and document reports, exports, and the activity log',
    group: 'Run and review',
  },
]

/** Sidebar groups, in order, each with its items. Derived so the two cannot drift. */
export function navGroups(): { group: string; items: NavItem[] }[] {
  const groups: { group: string; items: NavItem[] }[] = []
  for (const item of NAV) {
    const existing = groups.find((g) => g.group === item.group)
    if (existing) existing.items.push(item)
    else groups.push({ group: item.group, items: [item] })
  }
  return groups
}

export function titleForPath(pathname: string): string {
  const base = pathname.replace(/^\/ppd_converter/, '') || '/'
  return NAV.find((n) => n.path === base)?.label ?? 'PPD Converter'
}
