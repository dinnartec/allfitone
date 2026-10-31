import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  installStudioApiMock,
  secondActiveMembership,
} from './studio-api-mock'

const ORG = activeMembership.organization_id

async function open(page: Page, membership = activeMembership) {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [membership], organizationMemberships: coachedTeam() }),
  )
  await page.goto(`/organizations/${membership.organization_id}/clients`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/**
 * The first acceptance criterion: the header distinguishes what you do from
 * what you consult. Three links drawn the same way, in the same place, said
 * they were three of a kind.
 */
test('the header carries one action, and it is the only thing you do from here', async ({
  page,
}) => {
  await open(page)

  const actions = page.locator('[data-page-header-actions]')
  await expect(actions.getByRole('link')).toHaveCount(1)
  await expect(actions.getByRole('link')).toHaveText('Invitar cliente')
})

/**
 * The consultations close the section rather than crowding its top. Asserted on
 * document order, not on pixels: the point is that the list comes first.
 */
test('the consultations close the section, after the list', async ({ page }) => {
  await open(page)

  const order = await page.evaluate(() => {
    const section = document.querySelector('[data-client-page]')
    if (!section) throw new Error('la sección del directorio no está en la página')
    const everything = Array.from(section.querySelectorAll('*'))
    const index = (selector: string) => everything.findIndex((element) => element.matches(selector))
    return {
      header: index('[data-page-header]'),
      filters: index('[data-slot="toggle-group"]'),
      list: index('[data-studio-register="clients"], [data-client-directory-cards]'),
      references: index('[data-client-references]'),
    }
  })

  expect(order.header).toBeGreaterThanOrEqual(0)
  expect(order.filters).toBeGreaterThan(order.header)
  expect(order.list).toBeGreaterThan(order.filters)
  expect(order.references).toBeGreaterThan(order.list)
})

/**
 * They read as links, which means underlined at rest rather than on hover, in a
 * colour that is not the text's own.
 *
 * The second half is the real guard. `--afo-color-border` does not exist in the
 * Design System, and an invalid custom property in `text-decoration-color`
 * falls back to `currentcolor` — so the underline silently renders at full ink
 * and the `:hover` rule has nothing left to change. Nothing looks broken; it
 * just stops meaning what the rule says. Comparing the two computed colours is
 * what catches it.
 */
test('the consultations are underlined at rest, in a colour of their own', async ({ page }) => {
  await open(page)

  const styles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-client-reference]')).map((link) => {
      const computed = getComputedStyle(link)
      return {
        text: (link.textContent ?? '').trim(),
        decoration: computed.textDecorationLine,
        decorationColor: computed.textDecorationColor,
        color: computed.color,
      }
    }),
  )

  expect(styles).toHaveLength(2)
  for (const link of styles) {
    expect(link.decoration, `"${link.text}" no está subrayado en reposo`).toContain('underline')
    expect(
      link.decorationColor,
      `el subrayado de "${link.text}" cayó a currentcolor: el token no resolvió`,
    ).not.toBe(link.color)
  }
})

/**
 * The third criterion: both references stay reachable from where a person looks
 * for them. "Categorías de información" had no click test at all before this —
 * it was reachable only by typing the URL.
 */
test('the two consultations are reachable by clicking, from the directory', async ({ page }) => {
  await open(page)

  const references = page.getByRole('navigation', { name: 'Consultas sobre los clientes' })
  await expect(references.getByRole('link')).toHaveCount(2)

  await references.getByRole('link', { name: 'Categorías de información' }).click()
  await expect(page).toHaveURL(new RegExp(`${ORG}/clients/information-categories$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Categorías de información')

  await page.goBack()
  await page
    .getByRole('navigation', { name: 'Consultas sobre los clientes' })
    .getByRole('link', { name: 'Autorizaciones' })
    .click()
  await expect(page).toHaveURL(new RegExp(`${ORG}/clients/authorizations$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autorizaciones')
})

/**
 * The second criterion, measured rather than eyeballed. Inside the header's
 * action row the shared rule below 640px gives every child an equal share of
 * the width, so three of them took a third each and the labels broke mid-word.
 */
test('on a phone no reference is cut off or clipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)

  const measurements = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[data-client-reference]'))
    return links.map((link) => {
      const box = link.getBoundingClientRect()
      return {
        text: (link.textContent ?? '').trim(),
        clipped: link.scrollWidth > link.clientWidth + 1,
        insideViewport: box.left >= 0 && box.right <= document.documentElement.clientWidth,
      }
    })
  })

  expect(measurements).toHaveLength(2)
  for (const link of measurements) {
    expect(link.clipped, `"${link.text}" quedó recortado`).toBe(false)
    expect(link.insideViewport, `"${link.text}" se sale de la pantalla`).toBe(true)
  }

  // And the page itself never scrolls sideways.
  const page_ = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(page_.document).toBeLessThanOrEqual(page_.viewport)
})

/**
 * Neither consultation depends on being able to invite: a coach who only
 * attends clients still needs to know what may be asked of them.
 */
test('a role without the invite action keeps both consultations', async ({ page }) => {
  await open(page, secondActiveMembership)

  const references = page.getByRole('navigation', { name: 'Consultas sobre los clientes' })
  await expect(references.getByRole('link', { name: 'Categorías de información' })).toBeVisible()
  await expect(references.getByRole('link', { name: 'Autorizaciones' })).toBeVisible()
})
