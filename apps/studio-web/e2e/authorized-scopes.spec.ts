import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  error,
  grantedHealthContext,
  installStudioApiMock,
  relationshipState,
  withdrawnBodyProgress,
  type StudioApiFixture,
} from './studio-api-mock'

const ORG = activeMembership.organization_id
const PATH = `/organizations/${ORG}/clients/authorizations`
const DESKTOP = { width: 1600, height: 900 }
const MOBILE = { width: 390, height: 844 }
const LIST_READ = /\/authorized-scopes(\?|$)/

const base = (intercept?: StudioApiFixture['intercept']) =>
  createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
    ...(intercept ? { intercept } : {}),
  })

async function open(page: Page, fixture = base()) {
  await installStudioApiMock(page, fixture)
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP)
})

/*
 * Criterion 1: what each person authorized, and since when.
 */
test('T-STUDIO-035-01 says what each person authorized and from when', async ({ page }) => {
  await open(page)

  const register = page.locator('[data-authorized-scope-page]')
  await expect(register.getByText('Contexto de salud')).toBeVisible()
  await expect(register.getByText('Ana Álvarez').first()).toBeVisible()
  // The date the authorization started, in the reader's format rather than ISO.
  await expect(register.getByText('04/03/2025').first()).toBeVisible()
})

/*
 * Criterion 4. A withdrawn authorization is not dropped: it is what explains no
 * longer seeing that part, and it carries the date it ended.
 */
test('T-STUDIO-035-02 a withdrawn authorization stays, with the date it ended', async ({
  page,
}) => {
  await open(page)

  const register = page.locator('[data-authorized-scope-page]')
  await expect(register.getByText('Progreso corporal')).toBeVisible()
  await expect(register.getByText('Retirada').first()).toBeVisible()
  await expect(register.getByText('19/07/2025')).toBeVisible()
})

/*
 * Criterion 3, pinned rather than read. The register names what was authorized
 * and never shows it, so the day somebody adds a column carrying content — a
 * measurement, a note, an injury — this fails.
 */
test('T-STUDIO-035-03 shows the state of each permission and nothing it covers', async ({
  page,
}) => {
  await open(page)

  // Compared lowercased: the Design System uppercases a header through CSS, and
  // what this pins is which columns exist, not how they are drawn.
  const headers = await page.locator('[data-authorized-scope-page] thead th').allInnerTexts()
  expect(headers.map((header) => header.toLocaleLowerCase('es'))).toEqual([
    'persona',
    'categoría',
    'estado',
    'desde',
    'retirada',
  ])

  // And the register says so in the words a reader sees, not only in its shape.
  await expect(page.getByText(/no lo que esa autorización ampara/)).toBeVisible()
})

test('T-STUDIO-035-04 a page with nothing yet says what will fill it', async ({ page }) => {
  await open(
    page,
    base((request) =>
      LIST_READ.test(request.path)
        ? { status: 200, body: { data: [], page: { has_more: false, next_cursor: null } } }
        : undefined,
    ),
  )

  await expect(page.getByText('Nadie ha autorizado nada todavía')).toBeVisible()
})

test('T-STUDIO-035-05 a failed load is announced and offers a retry', async ({ page }) => {
  await open(
    page,
    base((request) =>
      LIST_READ.test(request.path)
        ? { status: 503, body: error('upstream-unavailable') }
        : undefined,
    ),
  )

  const register = page.locator('[data-authorized-scope-page]')
  await expect(register.getByRole('alert')).toContainText('No pudimos cargar las autorizaciones')
  await expect(register.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

test('T-STUDIO-035-06 a reader the API refuses is told, not shown an outage', async ({ page }) => {
  await open(
    page,
    base((request) =>
      LIST_READ.test(request.path) ? { status: 403, body: error('forbidden') } : undefined,
    ),
  )

  await expect(page.getByText('No tienes acceso a estas autorizaciones')).toBeVisible()
})

/*
 * The register answers with cards when its container has no room, and the two
 * presentations carry the same facts — the second being the one a phone gets.
 */
test('T-STUDIO-035-07 on a phone the same facts arrive as cards', async ({ page }) => {
  await page.setViewportSize(MOBILE)
  await open(page)

  await expect(page.locator('table')).toHaveCount(0)
  const cards = page.locator('[data-authorized-scope-card]')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('Contexto de salud')
  await expect(cards.nth(1)).toContainText('Retirada')
})

/*
 * The regex that titles a relationship is a bare `[^/]+`, so every static route
 * beside it has to be excluded by name. Without that, this page is titled
 * "Vínculo" — which is what happened to the categories screen.
 */
test('T-STUDIO-035-08 the workspace names the page, not the relationship pattern', async ({
  page,
}) => {
  await open(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autorizaciones')
})

/*
 * A route nobody links to is not a screen, it is a URL. Kevin asked how one
 * reaches this page and the honest answer at the time was "by typing it", which
 * is what this guards against coming back.
 */
test('T-STUDIO-035-10 the client directory leads here', async ({ page }) => {
  await installStudioApiMock(page, base())
  await page.goto(`/organizations/${ORG}/clients`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('link', { name: 'Autorizaciones' }).click()

  await expect(page).toHaveURL(new RegExp(`${ORG}/clients/authorizations$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autorizaciones')
})

test('T-STUDIO-035-09 the grant ids and scope codes never reach the reader', async ({ page }) => {
  await open(page)

  const text = (await page.locator('[data-authorized-scope-page]').innerText()).toLowerCase()
  expect(text).not.toContain(grantedHealthContext.grant_id)
  expect(text).not.toContain(withdrawnBodyProgress.grant_id)
  // The code is English and twenty-two characters; the reader gets the words.
  expect(text).not.toContain('health_context')
})
