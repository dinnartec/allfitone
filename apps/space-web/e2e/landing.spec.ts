/**
 * Smoke and accessibility sweep of every public page, on desktop and phone.
 *
 * axe runs against WCAG 2.2 AA (DT-010). Only `serious` and `critical` impacts
 * fail the suite; lower ones are printed for review, as Studio does.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
const BLOCKING = new Set(['serious', 'critical'])
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]
const PAGES = [
  { path: '/es', heading: /ENTRENA/ },
  { path: '/en', heading: /TRAIN/ },
  { path: '/es/privacidad', heading: /Política de tratamiento/ },
  { path: '/en/privacidad', heading: /Personal data processing/ },
  { path: '/es/terminos', heading: /Términos y condiciones/ },
  { path: '/en/terminos', heading: /Terms and conditions/ },
]

test.describe('language', () => {
  test('the root sends a Spanish browser to Spanish', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'es-CO' })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveURL(/\/es$/)
    await context.close()
  })

  test('the root sends an English browser to English', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveURL(/\/en$/)
    await context.close()
  })

  test('a page without a language keeps its path', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'es-CO' })
    const page = await context.newPage()
    await page.goto('/privacidad')
    await expect(page).toHaveURL(/\/es\/privacidad$/)
    await context.close()
  })

  test('a language the site does not have is not found', async ({ page }) => {
    const response = await page.goto('/es/fr')
    expect(response?.status()).toBe(404)
  })

  test('the switch keeps the visitor on the same page', async ({ page }) => {
    await page.goto('/es/terminos')
    await page.getByRole('link', { name: 'EN', exact: true }).click()
    await expect(page).toHaveURL(/\/en\/terminos$/)
  })
})

test('the stores read as coming soon while there is no link', async ({ page }) => {
  await page.goto('/es')
  await expect(page.getByText('Próximamente en').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /App Store|Google Play/ })).toHaveCount(0)
})

test('the legal pages say they are drafts', async ({ page }) => {
  await page.goto('/es/privacidad')
  await expect(page.getByText('Versión preliminar')).toBeVisible()
})

for (const viewport of VIEWPORTS) {
  test.describe(`accessibility · ${viewport.name}`, () => {
    for (const target of PAGES) {
      test(target.path, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(target.path)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.heading)

        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        for (const violation of results.violations) {
          const where = violation.nodes.map((node) => node.target.join(' ')).join(' | ')
          console.log(
            `[${violation.impact ?? '-'}] ${violation.id} — ${violation.help}\n    ${where}`,
          )
        }
        const blocking = results.violations.filter(({ impact }) => BLOCKING.has(impact ?? ''))
        expect(blocking.map(({ id }) => id)).toEqual([])
      })
    }
  })
}
