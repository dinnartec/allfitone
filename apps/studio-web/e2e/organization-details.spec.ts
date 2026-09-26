import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  organizationWithoutSites,
} from './studio-api-mock'

const organizationPath = `/organizations/${activeMembership.organization_id}/organization`

test('reads the organization and every site it operates from', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await page.getByRole('link', { name: 'Organización', exact: true }).click()
  await expect(page).toHaveURL(/\/organization$/)

  // The route's own h1 belongs to the workspace bar. The organization's name
  // is a fact on this screen, and the one the API returned rather than the one
  // cached in the membership.
  await expect(page.getByRole('heading', { name: 'Organización', level: 1 })).toBeVisible()

  // Scoped to the fact list: the sidebar carries the organization name and its
  // type too, so an unscoped match finds the navigation rather than the screen.
  const facts = page.locator('[data-organization-facts]')
  await expect(facts.getByText('Allfit Gym', { exact: true })).toBeVisible()
  await expect(facts.getByText('Allfit Gym SAS')).toBeVisible()
  await expect(facts.getByText('Gimnasio')).toBeVisible()

  // A withdrawn site stays on the list. It is the only way to tell that the
  // organization once operated from there, and the count says so out loud.
  const sites = page.getByRole('list', { name: 'Sedes de la organización' })
  await expect(sites.getByRole('listitem')).toHaveCount(3)
  await expect(sites.getByText('Sede Chicó')).toBeVisible()
  await expect(sites.getByText('Sin dirección registrada')).toBeVisible()
})

test('names both absences instead of dropping their rows', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({
      memberships: [activeMembership],
      organization: organizationWithoutSites,
    }),
  )
  await page.goto(organizationPath)

  await expect(page.getByText('Sin razón social registrada')).toBeVisible()
  await expect(page.getByText('Aún no hay sedes registradas')).toBeVisible()
  // The label survives even when the value does not: a reader has to be able
  // to tell that the question was asked and came back empty.
  await expect(page.getByText('Razón social', { exact: true })).toBeVisible()
})

/**
 * HU-STUDIO-011, criterion 2. PostgreSQL answers the same 'organization not
 * found' whether the row is absent or this account holds no membership in it,
 * so the two reach the browser as one 404.
 *
 * The client is the layer that could undo that, because it knows which
 * organizations the person belongs to and could helpfully say "this one is not
 * yours". That sentence is the leak: it would confirm the organization exists.
 */
test('an organization it cannot read never says which of the two reasons applies', async ({
  page,
}) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [activeMembership], organization: null }),
  )
  await page.goto(organizationPath)

  await expect(page.getByText('No encontramos esta organización')).toBeVisible()

  const body = (await page.locator('body').innerText()).toLowerCase()
  for (const leak of ['no perteneces', 'no tienes permiso', 'sin acceso', 'no autorizado']) {
    expect(body).not.toContain(leak)
  }

  // Retrying cannot turn a denial into a read, so the screen must not offer it.
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('an outage offers a retry, and the retry succeeds once the read recovers', async ({
  page,
}) => {
  let failing = true
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) =>
      failing &&
      request.method === 'GET' &&
      /^\/studio\/v1\/organizations\/[^/]+$/.test(request.path)
        ? { status: 503, body: { type: 'about:blank', title: 'upstream-unavailable', status: 503 } }
        : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(organizationPath)

  await expect(page.getByText('No pudimos cargar los datos de tu organización')).toBeVisible()

  failing = false
  await page.getByRole('button', { name: 'Reintentar' }).click()

  await expect(page.locator('[data-organization-facts]').getByText('Allfit Gym SAS')).toBeVisible()
})

/**
 * Found in review, not by the sweep. The name and the address were inline
 * siblings with nothing between them, so the row read "Sede ChapineroCalle 63"
 * as one word. Every axe and layout check passed on it: no rule was broken,
 * the screen was simply unreadable.
 *
 * The assertions measure the relationship rather than the pixel values, so a
 * change to the spacing scale keeps this honest instead of brittle.
 */
test('each site reads as a block, not as a run of lines', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
    await page.goto(organizationPath)
    await expect(page.getByRole('list', { name: 'Sedes de la organización' })).toBeVisible()

    const rows = await page.evaluate(() => {
      const entries = [...document.querySelectorAll('[data-organization-site]')]
      return entries.map((entry, index) => {
        const name = entry.querySelector('strong') as HTMLElement
        const address = entry.querySelector('[data-organization-site-address]') as HTMLElement
        const next = entries[index + 1]
        return {
          name: name.textContent ?? '',
          insideRow: Math.round(
            address.getBoundingClientRect().top - name.getBoundingClientRect().bottom,
          ),
          sharesLine:
            Math.abs(address.getBoundingClientRect().top - name.getBoundingClientRect().top) < 2,
          toNextRow: next
            ? Math.round(next.getBoundingClientRect().top - entry.getBoundingClientRect().bottom)
            : null,
        }
      })
    })

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row.sharesLine, `${row.name} at ${viewport.width}px`).toBe(false)
      expect(row.insideRow, `${row.name} at ${viewport.width}px`).toBeGreaterThan(0)
      // What belongs together separates less than what merely follows it.
      if (row.toNextRow !== null) {
        expect(row.toNextRow, `${row.name} at ${viewport.width}px`).toBeGreaterThan(row.insideRow)
      }
    }
  }
})
