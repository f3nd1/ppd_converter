import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { NAV } from '../nav.ts'

// Frontend behaviour the brief names explicitly. The API is stubbed at fetch so
// no server, database or Google account is involved.

const criteria = Array.from({ length: 7 }, (_, i) => ({
  id: `c${i + 1}`,
  number: i + 1,
  title: `Criterion ${i + 1}`,
  subCriteria:
    i === 0
      ? [
          {
            id: 'sub1',
            code: '1.1',
            title: 'Leadership',
            order: 1,
            isActive: true,
            sourceMapping: {
              id: 'm1',
              oldUrl: 'https://drive.google.com/drive/folders/old',
              newUrl: 'https://drive.google.com/drive/folders/new',
              oldResourceType: 'folder',
              newResourceType: 'folder',
              validationStatus: 'valid',
              errorDetail: null,
              lastScannedAt: null,
              sourceDocCount: 2,
            },
          },
        ]
      : [],
}))

const AUTHORISED = {
  email: 'felix@unitedceres.edu.sg',
  authorised: true,
  capabilities: { google: true, openai: true, session: true },
  allowedAccount: 'felix@unitedceres.edu.sg',
}

const responses: Record<string, unknown> = {
  '/auth/me': AUTHORISED,
  '/dashboard': {
    totals: { sourceDocuments: 2, criteria: 7, subCriteria: 1 },
    status: { notStarted: 2, queued: 0, processing: 0, migrated: 0, awaitingReview: 0, approved: 0, failed: 0 },
    validationIssues: 0,
    progressPercent: 0,
    activeTemplate: null,
    activeAIInstruction: { id: 'i1', versionLabel: 'v1' },
    activeMapping: null,
    recentActivity: [],
  },
  '/criteria': { criteria },
  '/migration/readiness': {
    allowed: false,
    blockers: ['No approved active mapping version exists. Migration is blocked.'],
  },
  '/source-documents': { documents: [] },
  '/migration/status': { jobs: [], running: false },
  '/template/versions': { versions: [], defaultTargetSections: ['Policy and Approach'] },
  '/ai-instructions': { versions: [] },
  '/mapping-versions': { versions: [] },
  '/reports/migration': {
    totalDocuments: 0,
    statusCounts: {},
    byCriterion: [],
    bySubCriterion: [],
    completenessPercent: 0,
    validationWarnings: 0,
    validationFailures: 0,
    approvedCount: 0,
    failedCount: 0,
    startedAt: null,
    completedAt: null,
  },
  '/activity?limit=200': { entries: [] },
}

let posted: { url: string; body: unknown }[] = []

beforeEach(() => {
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace('/ppd_converter/api', '')
      if (init?.method && init.method !== 'GET') {
        posted.push({ url: path, body: init.body ? JSON.parse(String(init.body)) : null })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      const body = responses[path]
      if (body === undefined) {
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 })
      }
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )

/** Renders and waits for the auth check to finish, so pages are mounted. */
async function renderSignedIn(route: string) {
  renderAt(route)
  await waitFor(() => expect(screen.queryByText('Checking your sign-in…')).toBeNull())
}

describe('navigation', () => {
  it('has exactly five primary navigation areas', async () => {
    expect(NAV).toHaveLength(5)
    await renderSignedIn('/')
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
  })

  it('names the five areas from the brief', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Dashboard',
      'Source Documents',
      'Template and AI Rules',
      'Migration and Validation',
      'Reports and Activity',
    ])
  })

  it('renders each page at its route', async () => {
    for (const item of NAV) {
      renderAt(item.path)
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
      cleanup()
    }
  })
})

describe('Dashboard', () => {
  it('shows live counts rather than hardcoded statistics', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByText('Source documents')).toBeTruthy())
    const tile = screen.getByText('Source documents').closest('.stat') as HTMLElement
    expect(within(tile).getByText('2')).toBeTruthy()
  })

  it('flags that migration is blocked with no approved mapping', async () => {
    renderAt('/')
    await waitFor(() =>
      expect(screen.getByText(/No approved active mapping/i)).toBeTruthy(),
    )
  })
})

describe('Source Documents', () => {
  it('shows all seven criteria', async () => {
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByText(/Criterion 1/)).toBeTruthy())
    for (let n = 1; n <= 7; n += 1) {
      expect(screen.getByText(new RegExp(`Criterion ${n}\\b`))).toBeTruthy()
    }
  })

  it('expands and collapses a criterion', async () => {
    const user = userEvent.setup()
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByText(/Criterion 1/)).toBeTruthy())

    const details = document.querySelectorAll('details')
    expect(details[0]!.open).toBe(false)
    await user.click(screen.getByText(/Criterion 1/))
    expect(details[0]!.open).toBe(true)
    await user.click(screen.getByText(/Criterion 1/))
    expect(details[0]!.open).toBe(false)
  })

  it('shows the literal old link → new link arrow', async () => {
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByTestId('link-row')).toBeTruthy())
    const row = screen.getByTestId('link-row')
    expect(row.textContent).toContain('→')
    expect(within(row).getByText('Old Google link')).toBeTruthy()
    expect(within(row).getByText('New Google link')).toBeTruthy()
    // The arrow sits between the two links, in that order.
    expect(row.textContent!.indexOf('Old')).toBeLessThan(row.textContent!.indexOf('→'))
    expect(row.textContent!.indexOf('→')).toBeLessThan(row.textContent!.indexOf('New'))
  })

  it('adds a sub-criterion', async () => {
    const user = userEvent.setup()
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getAllByLabelText('Sub-criterion code')[0]).toBeTruthy())

    await user.type(screen.getAllByLabelText('Sub-criterion code')[0]!, '1.2')
    await user.type(screen.getAllByLabelText('Sub-criterion title')[0]!, 'Finance')
    await user.click(screen.getAllByRole('button', { name: 'Add sub-criterion' })[0]!)

    await waitFor(() => expect(posted.some((p) => p.url === '/sub-criteria')).toBe(true))
    expect(posted[0]!.body).toMatchObject({ code: '1.2', title: 'Finance' })
  })

  it('edits a sub-criterion link', async () => {
    const user = userEvent.setup()
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByTestId('sub-criterion-row')).toBeTruthy())

    await user.click(within(screen.getByTestId('sub-criterion-row')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save links' }))
    await waitFor(() => expect(posted.some((p) => p.url.includes('/links'))).toBe(true))
  })

  it('shows the source document count and status', async () => {
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByText('2 source document(s)')).toBeTruthy())
    expect(screen.getByText('valid')).toBeTruthy()
  })

  it('disables Scan source until links are validated', async () => {
    responses['/criteria'] = {
      criteria: criteria.map((c, i) =>
        i === 0
          ? {
              ...c,
              subCriteria: [
                { ...c.subCriteria[0]!, sourceMapping: { ...c.subCriteria[0]!.sourceMapping!, validationStatus: 'not_validated' } },
              ],
            }
          : c,
      ),
    }
    renderAt('/source-documents')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan source' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Scan source' })).toHaveProperty('disabled', true)
    responses['/criteria'] = { criteria }
  })
})

describe('Template and AI Rules', () => {
  it('offers a Google Docs template URL field, not a file upload', async () => {
    renderAt('/template-and-rules')
    await waitFor(() => expect(screen.getByLabelText('Google Docs template link')).toBeTruthy())
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('disables activation until the template validates', async () => {
    renderAt('/template-and-rules')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save as active template' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Save as active template' })).toHaveProperty('disabled', true)
  })

  it('shows an empty state when no template is configured', async () => {
    renderAt('/template-and-rules')
    await waitFor(() => expect(screen.getByText(/No template has been configured yet/)).toBeTruthy())
  })

  it('shows the mapping tab blocked when no approved mapping exists', async () => {
    const user = userEvent.setup()
    renderAt('/template-and-rules')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Section Mapping' })).toBeTruthy())
    await user.click(screen.getByRole('tab', { name: 'Section Mapping' }))
    await waitFor(() =>
      expect(screen.getByText(/Migration is blocked: no approved active mapping/i)).toBeTruthy(),
    )
  })
})

describe('Migration and Validation', () => {
  it('shows migration blocked without an approved mapping', async () => {
    renderAt('/migration')
    await waitFor(() =>
      expect(screen.getByText(/No approved active mapping version exists/i)).toBeTruthy(),
    )
  })

  it('shows empty states for documents and status', async () => {
    renderAt('/migration')
    await waitFor(() => expect(screen.getByText(/No source documents/)).toBeTruthy())
    expect(screen.getByText(/No migrations have been queued/)).toBeTruthy()
  })

  it('offers criterion, status and title filters', async () => {
    renderAt('/migration')
    await waitFor(() => expect(screen.getByLabelText('Filter by criterion')).toBeTruthy())
    expect(screen.getByLabelText('Filter by status')).toBeTruthy()
    expect(screen.getByLabelText('Filter by document title')).toBeTruthy()
  })
})

describe('Reports and Activity', () => {
  it('offers CSV, JSON and printable HTML exports', async () => {
    renderAt('/reports')
    await waitFor(() => expect(screen.getByText('CSV summary')).toBeTruthy())
    expect(screen.getByText('JSON full record')).toBeTruthy()
    expect(screen.getByText('Printable HTML')).toBeTruthy()
  })

  it('shows empty states with no data', async () => {
    renderAt('/reports')
    await waitFor(() => expect(screen.getByText(/No documents have been scanned yet/)).toBeTruthy())
    expect(screen.getByText(/No activity recorded yet/)).toBeTruthy()
  })
})

describe('error states', () => {
  it('shows an error with its correlation id when a page request fails', async () => {
    // The auth check succeeds, so we are past the sign-in gate and looking at a
    // genuine page failure — which is where a correlation id has to appear.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).endsWith('/auth/me')) {
          return new Response(JSON.stringify(AUTHORISED), { status: 200 })
        }
        return new Response(
          JSON.stringify({ error: 'Database unavailable', correlationId: 'abc-123' }),
          { status: 500 },
        )
      }),
    )
    await renderSignedIn('/')
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/Database unavailable/)).toBeTruthy()
    expect(screen.getByText('abc-123')).toBeTruthy()
  })

  it('shows the sign-in screen, not a page error, when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    renderAt('/')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign in with Google' })).toBeTruthy(),
    )
  })
})

describe('sign-in gate', () => {
  // The reason this exists: on first deployment the app 401'd on every page,
  // showed "Something went wrong", and offered no way to sign in at all.
  const signedOut = (over: Record<string, unknown> = {}) => ({
    email: null,
    authorised: false,
    capabilities: { google: true, openai: true, session: true },
    allowedAccount: 'felix@unitedceres.edu.sg',
    ...over,
  })

  afterEach(() => {
    responses['/auth/me'] = AUTHORISED
  })

  it('shows a sign-in screen, not an error, when not signed in', async () => {
    responses['/auth/me'] = signedOut()
    renderAt('/')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign in with Google' })).toBeTruthy(),
    )
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('points the sign-in link at the OAuth route under the base path', async () => {
    responses['/auth/me'] = signedOut()
    renderAt('/')
    const link = await waitFor(() => screen.getByRole('link', { name: 'Sign in with Google' }))
    expect(link.getAttribute('href')).toBe('/ppd_converter/api/auth/google/start')
  })

  it('names the wrong account plainly when someone else signs in', async () => {
    responses['/auth/me'] = signedOut({ email: 'someone.else@example.com' })
    renderAt('/')
    await waitFor(() => expect(screen.getByText('someone.else@example.com')).toBeTruthy())
    expect(screen.getByText(/not authorised/i)).toBeTruthy()
  })

  it('says so when Google is not configured on the server', async () => {
    responses['/auth/me'] = signedOut({
      capabilities: { google: false, openai: true, session: true },
    })
    renderAt('/')
    await waitFor(() => expect(screen.getByText(/Google sign-in is not configured/i)).toBeTruthy())
  })

  it('shows the signed-in account and a sign-out button once authorised', async () => {
    await renderSignedIn('/')
    expect(screen.getByText('felix@unitedceres.edu.sg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('warns in the sidebar when OpenAI is not configured', async () => {
    responses['/auth/me'] = {
      ...AUTHORISED,
      capabilities: { google: true, openai: false, session: true },
    }
    await renderSignedIn('/')
    expect(screen.getByText('OpenAI is not configured')).toBeTruthy()
  })
})
