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
