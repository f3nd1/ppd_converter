import { expect, test } from '@playwright/test'

// Browser end-to-end over a real server and a real SQLite database, with Google
// and OpenAI unavailable. It proves the UI works, and — more importantly — that
// the SERVER refuses to migrate without an approved mapping, rather than merely
// greying out a button.
//
// Seeding goes through the API, so the routes are exercised too.

const BASE = '/ppd_converter'

test.describe('PPD Converter workflow', () => {
  test('the five primary areas are present and reachable', async ({ page }) => {
    await page.goto(`${BASE}/`)
    const nav = page.getByRole('navigation')
    await expect(nav.getByRole('link')).toHaveCount(5)

    for (const label of [
      'Dashboard',
      'Source Documents',
      'Template and AI Rules',
      'Migration and Validation',
      'Reports and Activity',
    ]) {
      await nav.getByRole('link', { name: label }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(label)
    }
  })

  test('seven criteria expand and collapse', async ({ page }) => {
    await page.goto(`${BASE}/source-documents`)
    const criteria = page.locator('.criteria details')
    await expect(criteria).toHaveCount(7)

    await expect(criteria.first()).not.toHaveAttribute('open', '')
    await criteria.first().locator('summary').click()
    await expect(criteria.first()).toHaveAttribute('open', '')
    await criteria.first().locator('summary').click()
    await expect(criteria.first()).not.toHaveAttribute('open', '')
  })

  test('a sub-criterion can be added and shows the old → new arrow', async ({ page }) => {
    await page.goto(`${BASE}/source-documents`)
    const first = page.locator('.criteria details').first()
    await first.locator('summary').click()

    await first.getByLabel('Sub-criterion code').fill('1.1')
    await first.getByLabel('Sub-criterion title').fill('Leadership and Corporate Governance')
    await first.getByRole('button', { name: 'Add sub-criterion' }).click()

    const row = first.getByTestId('link-row').first()
    await expect(row).toBeVisible()
    // The literal arrow is a requirement, not decoration.
    await expect(row).toContainText('→')
  })

  test('links can be saved and are shown around the arrow', async ({ page }) => {
    await page.goto(`${BASE}/source-documents`)
    const first = page.locator('.criteria details').first()
    await first.locator('summary').click()

    const subRow = first.getByTestId('sub-criterion-row').first()
    await subRow.getByRole('button', { name: 'Edit' }).click()
    await subRow.getByLabel('Old Google link (folder or document)').fill(
      'https://drive.google.com/drive/folders/oldFolderId',
    )
    await subRow.getByLabel('New Google link (REVISED destination folder)').fill(
      'https://drive.google.com/drive/folders/newFolderId',
    )
    await subRow.getByRole('button', { name: 'Save links' }).click()

    const row = first.getByTestId('link-row').first()
    await expect(row.getByText('Old Google link')).toBeVisible()
    await expect(row.getByText('New Google link')).toBeVisible()
  })

  test('an invalid Google URL is rejected with a specific reason', async ({ page }) => {
    await page.goto(`${BASE}/source-documents`)
    const first = page.locator('.criteria details').first()
    await first.locator('summary').click()

    const subRow = first.getByTestId('sub-criterion-row').first()
    await subRow.getByRole('button', { name: 'Edit' }).click()
    await subRow.getByLabel('Old Google link (folder or document)').fill('https://evil.example.com/x')
    await subRow.getByRole('button', { name: 'Save links' }).click()

    await expect(first.locator('.error-detail').first()).toContainText('not a Google Drive')
  })

  test('the template field takes a Google Docs URL and offers no file upload', async ({ page }) => {
    await page.goto(`${BASE}/template-and-rules`)
    await expect(page.getByLabel('Google Docs template link')).toBeVisible()
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
    // Activation stays disabled until validation succeeds.
    await expect(page.getByRole('button', { name: 'Save as active template' })).toBeDisabled()
  })

  test('AI instructions are versioned and the default set is active', async ({ page }) => {
    await page.goto(`${BASE}/template-and-rules`)
    await page.getByRole('tab', { name: 'AI Instructions' }).click()
    await expect(page.locator('.instructions')).toContainText('Use UK English.')
    await expect(page.locator('.instructions')).toContainText('Do not invent facts')
  })

  test('migration is blocked in the UI without an approved mapping', async ({ page }) => {
    await page.goto(`${BASE}/migration`)
    await expect(page.locator('.blocked')).toContainText('No approved active mapping version exists')
  })

  test('the SERVER refuses to queue a migration without an approved mapping', async ({ request }) => {
    // The real control. A disabled button proves nothing on its own.
    const response = await request.post(`${BASE}/api/migration/queue`, {
      data: { sourceDocumentIds: ['anything'] },
      headers: { origin: 'http://127.0.0.1:4021' },
    })
    expect(response.status()).toBe(409)
    expect(await response.text()).toContain('No approved active mapping')
  })

  test('a mapping version can be created, approved and activated', async ({ page }) => {
    await page.goto(`${BASE}/template-and-rules`)
    await page.getByRole('tab', { name: 'Section Mapping' }).click()

    await page.getByLabel('Version label').fill('v1')
    await page.getByRole('button', { name: 'Create version' }).click()

    const card = page.locator('.card', { hasText: 'Mapping v1' })
    await expect(card).toBeVisible()

    // Approval is refused while the version has no rules.
    await expect(card.getByRole('button', { name: 'Approve' })).toBeDisabled()

    await card.getByLabel('Old section name').fill('Responsibilities')
    await card.getByLabel('New target section').fill('PRACI Responsibility Matrix')
    await card.getByLabel('Transformation rule').fill('Move responsibilities into the PRACI matrix.')
    await card.getByRole('button', { name: 'Add rule' }).click()

    await expect(card.getByRole('button', { name: 'Approve' })).toBeEnabled()
    await card.getByRole('button', { name: 'Approve' }).click()
    await expect(card.getByRole('button', { name: 'Activate' })).toBeVisible()
    await card.getByRole('button', { name: 'Activate' }).click()
    await expect(card.getByText('Active')).toBeVisible()
  })

  test('an approved mapping version cannot be edited', async ({ page }) => {
    await page.goto(`${BASE}/template-and-rules`)
    await page.getByRole('tab', { name: 'Section Mapping' }).click()
    const card = page.locator('.card', { hasText: 'Mapping v1' })
    await expect(card).toContainText('Approved versions cannot be edited')
  })

  test('the dashboard reflects the approved mapping and reports live counts', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('.config-list')).toContainText('v1')
    const tile = page.locator('.stat', { hasText: 'Criteria' }).first()
    await expect(tile.locator('.stat-value')).toHaveText('7')
  })

  test('reports export and the activity log records what happened', async ({ page, request }) => {
    await page.goto(`${BASE}/reports`)
    await expect(page.getByText('CSV summary')).toBeVisible()

    const csv = await request.get(`${BASE}/api/reports/export?scope=activity&format=csv`)
    expect(csv.ok()).toBe(true)
    const text = await csv.text()
    expect(text).toContain('utc,singapore,action')
    // Everything significant is logged.
    expect(text).toContain('mapping_changed')
    expect(text).toContain('sub_criterion_changed')

    const html = await request.get(`${BASE}/api/reports/export?scope=migration&format=html`)
    expect(await html.text()).toContain('PPD Converter — Migration Report')
  })

  test('a deep link reload lands on the right page', async ({ page }) => {
    await page.goto(`${BASE}/reports`)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reports and Activity')
  })
})

test.describe('sign-in', () => {
  // Signed out: no storageState, so this is a genuine unauthenticated visit.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('an unauthenticated visitor gets a sign-in screen, not an error', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      `${BASE}/api/auth/google/start`,
    )
  })

  test('the app itself is not reachable while signed out', async ({ page }) => {
    await page.goto(`${BASE}/migration`)
    // The sign-in gate replaces the whole app, so the sidebar never renders.
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
  })
})

test.describe('signed-in chrome', () => {
  test('shows the signed-in account and a sign-out button', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('.account-email')).toHaveText('felix@unitedceres.edu.sg')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })
})
