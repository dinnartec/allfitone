import { expect, test, type Page } from '@playwright/test'

import { DESKTOP, SCREENS, openScreen } from './screens'
import { activeMembership, createStudioApiFixture, installStudioApiMock } from './studio-api-mock'

/**
 * Every visible control must come from the Design System: it carries a
 * `data-slot`, or sits inside something that does. Raw markup here is how a
 * surface drifts away from the shared library one element at a time.
 */
function designSystemViolations(page: Page): Promise<string[]> {
  return page.locator('button, input, select, textarea, table, dialog').evaluateAll((controls) =>
    controls
      .filter((control) => {
        const element = control as HTMLElement
        if (element.matches('[data-next-mark]')) return false
        const visible = element.getClientRects().length > 0
        if (!visible) return false
        return !element.matches('[data-slot]') && !element.closest('[data-slot]')
      })
      .map((control) => control.outerHTML.slice(0, 160)),
  )
}

test('uses canonical setup choices and one page heading without overflow', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture())
  await page.goto('/')

  const choices = page.locator('[data-slot="choice-card"]')
  await expect(choices).toHaveCount(3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  const independent = page.getByRole('button', { name: /Trabajo por mi cuenta/ })
  await independent.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Nombre visible')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  await page.getByRole('button', { name: 'Volver' }).click()
  await page.getByRole('button', { name: /Tengo un equipo o centro/ }).click()
  await expect(page.getByLabel('Tipo de organización')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
})

test('keeps visible controls inside a Design System contract', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  expect(await designSystemViolations(page)).toEqual([])
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})

/**
 * The contract above was only ever enforced on the team directory. The AFO-40
 * brief asks for Design System consistency across the fourteen implemented
 * stories, so the same check now sweeps every one of their screens.
 */
for (const screen of SCREENS) {
  test(`keeps ${screen.stories} inside the Design System contract`, async ({ page }) => {
    await openScreen(page, screen, DESKTOP)

    expect(await designSystemViolations(page), screen.stories).toEqual([])
  })
}

/**
 * A control fixed to the viewport lands on whatever the page puts behind it, so
 * it cannot borrow a background from a parent the way a control inside a panel
 * can. The privacy control used an outline variant, whose transparent fill left
 * only a border at roughly 1.24:1 against the entry background — invisible, and
 * not something the WCAG sweep catches, because axe does not automate non-text
 * contrast.
 */
test('the floating privacy control carries its own surface', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ signedOut: true }))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const measured = await page.getByRole('button', { name: 'Privacidad' }).evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    anchoring: getComputedStyle(element.parentElement as HTMLElement).position,
  }))

  expect(measured.anchoring, 'the control floats, so this test is about the right thing').toBe(
    'fixed',
  )
  expect(measured.background, 'a floating control with no surface reads as loose text').not.toBe(
    'rgba(0, 0, 0, 0)',
  )
})

/**
 * Analytics is optional, so the panel asking about it may never stand between a
 * person and signing in. This is the constraint that decides where the panel
 * opens: moving it to the corner the collapsed control uses looks tidier and
 * puts it straight on top of "Entrar a Studio" at 1280x720 and 390x844, because
 * the access landing places its primary action low.
 *
 * The check is what the browser would actually dispatch a click to, not a box
 * intersection, so a panel that overlaps harmlessly still passes.
 */
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`the consent panel leaves the primary action clickable at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installStudioApiMock(page, createStudioApiFixture({ signedOut: true }), {
      consent: 'undecided',
    })
    await page.goto('/')
    await expect(page.getByText('Analítica opcional')).toBeVisible()

    const action = page.getByRole('link', { name: /Entrar a Studio/ })
    const reachable = await action.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return topmost === element || element.contains(topmost)
    })

    expect(reachable, 'the consent panel is covering "Entrar a Studio"').toBe(true)
  })
}

test('ports the dark Studio sidebar to mobile and closes it after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await page.getByRole('button', { name: 'Abrir o cerrar navegación' }).click()
  const sidebar = page.locator('[data-slot="sidebar"][data-mobile="true"]')
  await expect(sidebar).toHaveAttribute('data-afo-theme', 'dark')
  await expect(sidebar.getByRole('img', { name: 'Allfit Studio' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  expect(
    await sidebar.evaluate((element) => {
      const channels = getComputedStyle(element).backgroundColor.match(/\d+(?:\.\d+)?/g)
      if (!channels || channels.length < 3) return Number.POSITIVE_INFINITY
      return Number(channels[0]) * 0.299 + Number(channels[1]) * 0.587 + Number(channels[2]) * 0.114
    }),
  ).toBeLessThan(128)
  expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await sidebar.getByRole('link', { name: 'Equipo' }).click()
  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}/team`)
  await expect(sidebar).toBeHidden()
})
