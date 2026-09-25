/**
 * Accessibility audit over every screen of the fourteen implemented Studio user
 * stories (HU-STUDIO-001..007, 014..018, 085..086).
 *
 * Why axe rather than hand-written colour maths: measuring contrast by walking
 * ancestors for a background misreports translucent overlays and elements that
 * inherit a colour they never paint. axe composites alpha against what is
 * actually behind an element and ignores non-painting nodes, so it does not
 * produce those false positives. This mirrors the harness already used in
 * `allfitone-design-system/apps/docs/e2e/explorer-navigation.spec.ts`.
 *
 * Only `serious` and `critical` impacts gate the suite. Lower impacts are
 * printed so a reviewer can see them without the suite failing on judgement
 * calls.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { DESKTOP, MOBILE, SCREENS, openScreen } from './screens'
import { createStudioApiFixture, installStudioApiMock } from './studio-api-mock'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] as const
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

for (const viewport of [DESKTOP, MOBILE]) {
  test.describe(`accessibility · ${viewport.name}`, () => {
    for (const screen of SCREENS) {
      test(`${screen.stories}`, async ({ page }) => {
        await openScreen(page, screen, viewport)

        const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()

        for (const violation of results.violations) {
          const where = violation.nodes.map((node) => node.target.join(' ')).join(' | ')
          console.log(`[${violation.impact}] ${violation.id} — ${violation.help}\n    ${where}`)
        }

        const blocking = results.violations.filter(({ impact }) =>
          BLOCKING_IMPACTS.has(impact ?? ''),
        )
        expect(blocking, `${screen.stories} @ ${viewport.name}`).toEqual([])
      })
    }
  })
}

/**
 * A green audit only means something if the audit can go red. Every rule in this
 * repository has to prove both halves, so this injects a contrast failure the
 * suite must catch. If this test ever passes silently, the audit above is
 * measuring nothing and its green is worthless.
 */
test('the audit detects a contrast failure', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture())
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.evaluate(() => {
    const probe = document.createElement('p')
    probe.textContent = 'Deliberately unreadable probe text'
    probe.style.color = '#f4f4f4'
    probe.style.backgroundColor = '#ffffff'
    probe.style.fontSize = '14px'
    document.body.append(probe)
  })

  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()
  const contrast = results.violations.filter((violation) => violation.id === 'color-contrast')

  expect(contrast, 'axe did not report the injected contrast failure').not.toEqual([])
  expect(contrast[0]?.impact).toBe('serious')
})

test.describe('layout', () => {
  for (const screen of SCREENS) {
    test(`${screen.stories} fits the mobile viewport`, async ({ page }) => {
      await openScreen(page, screen, MOBILE)

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }))
      expect(overflow.document, `${screen.stories} overflows horizontally`).toBeLessThanOrEqual(
        overflow.viewport,
      )

      // The document check alone misses whatever an ancestor scrolls or clips on
      // its own, which is how a grid whose tracks could not shrink kept its cards
      // 384px wide on a 390px screen through thirty-nine audited screens.
      //
      // The question is whether anything sits off the screen, not whether a box
      // is narrower than its own content: a long word in a heading exceeds its
      // content box and still wraps and reads perfectly. Regions that declare a
      // horizontal scroll are exempt, because scrolling a wide table is the
      // sanctioned pattern rather than a fault.
      const offscreen = await page.evaluate(() => {
        const scrollable = new Set(
          [...document.querySelectorAll<HTMLElement>('body *')].filter((element) =>
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowX),
          ),
        )
        const insideScrollRegion = (element: HTMLElement) => {
          for (let node = element.parentElement; node; node = node.parentElement) {
            if (scrollable.has(node)) return true
          }
          return false
        }
        return [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => {
            const box = element.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) return false
            return Math.round(box.right) > document.documentElement.clientWidth
          })
          .filter((element) => !insideScrollRegion(element))
          .map((element) => {
            const marker = [...element.attributes]
              .map((attribute) => attribute.name)
              .filter((name) => name.startsWith('data-'))
              .join(' ')
            const past =
              Math.round(element.getBoundingClientRect().right) -
              document.documentElement.clientWidth
            return `${element.tagName.toLowerCase()}${marker ? ` ${marker}` : ''} past by ${past}px`
          })
      })
      expect(offscreen, `${screen.stories} puts content off the screen`).toEqual([])

      // A wide table may scroll; a tab strip may not. The exemption above hides
      // this case, because the strip is the scroll region: a tab outside it is a
      // section the person never learns exists.
      //
      // Measured by scrolling rather than by comparing `scrollWidth` with
      // `clientWidth`: both are rounded, so a strip overflowing by a fraction of
      // a pixel reports as fitting. Known blind spot — this runs headless, where
      // text measures slightly narrower than in a real window, so a strip that
      // fits by a hair here can still scroll on someone's screen.
      const clippedTabs = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-slot="tabs-list"]')]
          .map((list) => {
            list.scrollLeft = list.scrollWidth
            const hidden = list.scrollLeft
            list.scrollLeft = 0
            return { label: list.getAttribute('aria-label') ?? 'tabs', hidden }
          })
          .filter(({ hidden }) => hidden > 0)
          .map(({ label, hidden }) => `${label} hides ${hidden}px`),
      )
      expect(clippedTabs, `${screen.stories} hides a tab behind a scroll`).toEqual([])

      // The privacy control floats over the bottom corner, so whatever ends
      // underneath it cannot be pressed. The credential card's "Retirar" lost
      // 86x29px of its target that way, and a tap there opened the analytics
      // panel instead.
      //
      // The question is reach, not position: sitting under the control is fine
      // while the page can scroll past it. So each control is brought into view
      // the way a person would, and only then asked what a tap at its centre
      // would hit. The page that cannot scroll clear is the page at fault.
      const covered = await page.evaluate(() => {
        const control = document.querySelector('[data-analytics-controls]')
        if (!control) return []
        const unreachable: string[] = []
        for (const element of document.querySelectorAll<HTMLElement>('a[href], button')) {
          if (control.contains(element)) continue
          const size = element.getBoundingClientRect()
          if (size.width === 0 || size.height === 0) continue
          element.scrollIntoView({ block: 'center', behavior: 'instant' })
          const box = element.getBoundingClientRect()
          const atCentre = document.elementFromPoint(
            (box.left + box.right) / 2,
            (box.top + box.bottom) / 2,
          )
          if (atCentre && control.contains(atCentre)) {
            unreachable.push((element.textContent ?? '').trim().slice(0, 30) || element.tagName)
          }
        }
        window.scrollTo(0, 0)
        return unreachable
      })
      expect(covered, `${screen.stories}: the privacy control covers a control`).toEqual([])

      // One h1 per screen: the audit brief asks for visual hierarchy, and a
      // page with zero or several top-level headings has none to speak of. A
      // spinner stage is exempt — it has no content to rank.
      //
      // A modal is the other shape this takes. It hides the page behind it from
      // assistive technology, which is correct and takes the h1 with it, so the
      // guarantee moves to the dialog: it must carry its own name.
      if (screen.hasHeading ?? true) {
        // `alertdialog` is its own role, and the confirmations use it — asking
        // only for `dialog` sent those screens back to the h1 rule they cannot
        // satisfy.
        const dialog = page.locator('[role="dialog"], [role="alertdialog"]')
        if ((await dialog.count()) > 0) {
          await expect(dialog.first()).toHaveAccessibleName(/\S/)
        } else {
          await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        }
      }
    })
  }
})
