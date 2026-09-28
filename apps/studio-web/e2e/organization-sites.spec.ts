import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  organizationWithLongSite,
  secondActiveMembership,
} from './studio-api-mock'

const organizationPath = `/organizations/${activeMembership.organization_id}/organization`
const newSitePath = `${organizationPath}/sites/new`

test('registers a site and finds it on the list it came from', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(organizationPath)

  await page.getByRole('link', { name: 'Registrar sede' }).click()
  await expect(page).toHaveURL(/\/organization\/sites\/new$/)

  await page.getByLabel('Nombre').fill('Sede Suba')
  await page.getByLabel('Dirección').fill('Calle 145 #91-19')
  await page.getByRole('button', { name: 'Registrar sede' }).click()

  // Back on the screen that asked for it, with the site already in place —
  // a redirect that left a stale list would be the same as not saving.
  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const sites = page.getByRole('list', { name: 'Sedes de la organización' })
  await expect(sites.getByText('Sede Suba')).toBeVisible()
  await expect(sites.getByText('Calle 145 #91-19')).toBeVisible()

  const created = fixture.requests.find(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/sites'),
  )
  expect(created?.body).toEqual({ name: 'Sede Suba', address: 'Calle 145 #91-19' })
})

test('an address of only spaces is sent as no address at all', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(newSitePath)

  await page.getByLabel('Nombre').fill('  Sede Norte  ')
  await page.getByLabel('Dirección').fill('   ')
  await page.getByRole('button', { name: 'Registrar sede' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const created = fixture.requests.find(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/sites'),
  )
  // Trimmed, and the blank address absent rather than present and empty, which
  // PostgreSQL rejects with a 422.
  expect(created?.body).toEqual({ name: 'Sede Norte' })
})

test('the name is required, and saying so costs no request', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(newSitePath)

  await page.getByRole('button', { name: 'Registrar sede' }).click()

  await expect(page.getByText('Escribe el nombre de la sede.')).toBeVisible()
  await expect(page).toHaveURL(/\/sites\/new$/)
  expect(fixture.requests.filter((entry) => entry.method === 'POST')).toHaveLength(0)
})

/**
 * HU-STUDIO-009 is for admin and owner. The server decides — it requires the
 * `manage_sites` capability — and the client reads the same catalog rather than
 * keeping its own copy of who holds it.
 */
test('a role that does not manage sites is refused in place, and never offered the control', async ({
  page,
}) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [secondActiveMembership] }),
  )
  const coachOrganization = `/organizations/${secondActiveMembership.organization_id}/organization`

  await page.goto(coachOrganization)
  await expect(page.getByRole('list', { name: 'Sedes de la organización' })).toBeVisible()
  // Readable, but not writable: the panel is there and the control is not.
  await expect(page.getByRole('link', { name: 'Registrar sede' })).toHaveCount(0)

  await page.goto(`${coachOrganization}/sites/new`)
  await expect(page.getByText('Tu rol no administra las sedes')).toBeVisible()
  await expect(page.getByLabel('Nombre')).toHaveCount(0)
})

test('a refused save keeps what was typed so the retry costs nothing', async ({ page }) => {
  let failing = true
  await installStudioApiMock(
    page,
    createStudioApiFixture({
      memberships: [activeMembership],
      intercept: (request) =>
        failing && request.method === 'POST' && request.path.endsWith('/sites')
          ? {
              status: 503,
              body: { type: 'about:blank', title: 'upstream-unavailable', status: 503 },
            }
          : undefined,
    }),
  )
  await page.goto(newSitePath)

  await page.getByLabel('Nombre').fill('Sede Kennedy')
  await page.getByRole('button', { name: 'Registrar sede' }).click()

  await expect(page.getByText('El registro de sedes está pausado temporalmente.')).toBeVisible()
  await expect(page.getByLabel('Nombre')).toHaveValue('Sede Kennedy')

  failing = false
  await page.getByRole('button', { name: 'Registrar sede' }).click()
  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
})

/**
 * Found in review, like the site rows before it. The alert and the button were
 * bare siblings in a section with no layout of its own, so they touched and
 * read as one block. Nothing was broken — the section simply had no rule.
 *
 * The button is also checked for width: stretched across the alert it would
 * read as a banner rather than as a control.
 */
test('the refusal separates its alert from the way out', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await installStudioApiMock(
      page,
      createStudioApiFixture({ memberships: [secondActiveMembership] }),
    )
    await page.goto(
      `/organizations/${secondActiveMembership.organization_id}/organization/sites/new`,
    )
    await expect(page.getByText('Tu rol no administra las sedes')).toBeVisible()

    const measured = await page.evaluate(() => {
      const block = document.querySelector('[data-site-form-refusal]') as HTMLElement
      const alert = block.querySelector('[role="alert"], [data-slot="alert"]') as HTMLElement
      const button = block.querySelector('button') as HTMLElement
      return {
        gap: Math.round(button.getBoundingClientRect().top - alert.getBoundingClientRect().bottom),
        buttonWidth: Math.round(button.getBoundingClientRect().width),
        alertWidth: Math.round(alert.getBoundingClientRect().width),
      }
    })

    expect(measured.gap, `gap at ${viewport.width}px`).toBeGreaterThanOrEqual(12)
    expect(measured.buttonWidth, `button width at ${viewport.width}px`).toBeLessThan(
      measured.alertWidth,
    )
  }
})

/**
 * Raised in review: what happens to the edit link when a site's name and
 * address are long? Every other fixture is short enough that the row was never
 * under pressure, so nothing in the suite answered it.
 *
 * The answer is that the identity column shrinks and wraps while the badge and
 * the link keep their size. This fixes that: the link must stay on screen, keep
 * a tappable size, and actually receive a tap at its centre.
 */
test('the edit link survives a site whose text fills the field', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await installStudioApiMock(
      page,
      createStudioApiFixture({
        memberships: [activeMembership],
        organization: organizationWithLongSite,
      }),
    )
    await page.goto(organizationPath)
    await expect(page.getByRole('link', { name: /^Editar Sede Villavicencio/ })).toBeVisible()

    const measured = await page.evaluate(() => {
      const row = document.querySelector('[data-organization-site]') as HTMLElement
      const link = row.querySelector('a') as HTMLElement
      link.scrollIntoView({ block: 'center', behavior: 'instant' })
      const box = link.getBoundingClientRect()
      const atCentre = document.elementFromPoint(
        (box.left + box.right) / 2,
        (box.top + box.bottom) / 2,
      )
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        right: Math.round(box.right),
        viewport: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth,
        reachable: link === atCentre || link.contains(atCentre),
      }
    })

    // The question the first version of this test forgot to ask. A link can be
    // on screen, tappable and reachable at its centre while the text beside it
    // is painted underneath it: an unbreakable name sets the column's minimum
    // width, overflows its own box and runs straight over its neighbours.
    const overlaps = await page.evaluate(() => {
      const row = document.querySelector('[data-organization-site]') as HTMLElement
      const identity = row.querySelector('[data-organization-site-identity]') as HTMLElement
      const others = [...row.children].filter((child) => child !== identity) as HTMLElement[]
      const hits = (a: HTMLElement, b: HTMLElement) => {
        const p = a.getBoundingClientRect()
        const q = b.getBoundingClientRect()
        return p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom
      }
      const texts = [...identity.children] as HTMLElement[]
      const found: string[] = []
      for (const text of texts) {
        for (const other of others) {
          if (hits(text, other)) {
            found.push(`${text.tagName.toLowerCase()} over ${other.tagName.toLowerCase()}`)
          }
        }
      }
      return found
    })

    const where = `at ${viewport.width}px`
    expect(overlaps, `nothing in the row is painted over ${where}`).toEqual([])
    expect(measured.overflow, `no horizontal overflow ${where}`).toBeLessThanOrEqual(
      measured.viewport,
    )
    expect(measured.right, `the link stays on screen ${where}`).toBeLessThanOrEqual(
      measured.viewport,
    )
    expect(measured.width, `tappable width ${where}`).toBeGreaterThanOrEqual(44)
    expect(measured.height, `tappable height ${where}`).toBeGreaterThanOrEqual(24)
    expect(measured.reachable, `a tap reaches the link ${where}`).toBe(true)
  }
})
