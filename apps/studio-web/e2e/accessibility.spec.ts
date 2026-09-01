/**
 * Accessibility audit over the screens of the fourteen implemented Studio user
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
import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  professionalCredential,
  professionalProfile,
  secondActiveMembership,
  terminatedMembership,
  type StudioApiFixture,
} from './studio-api-mock'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] as const
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

const workspace = `/organizations/${activeMembership.organization_id}`

interface Screen {
  stories: string
  path: string
  fixture: () => StudioApiFixture
  /** Interaction needed before the screen under audit is on the page. */
  reveal?: (page: Page) => Promise<void>
}

const memberOfTwo = () =>
  createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership, terminatedMembership],
  })

const withProfile = () =>
  createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [professionalCredential] },
      memberships: [activeMembership, terminatedMembership],
    },
    memberships: [activeMembership],
  })

const SCREENS: Screen[] = [
  {
    stories: 'HU-001 / HU-007 · entry and organization setup',
    path: '/',
    fixture: createStudioApiFixture,
  },
  { stories: 'HU-004 / HU-006 · workspace and memberships', path: workspace, fixture: memberOfTwo },
  { stories: 'HU-005 · professional profile', path: '/account', fixture: withProfile },
  {
    stories: 'HU-005 · declared credentials',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales opcionales' }).click()
    },
  },
  { stories: 'HU-017 · team directory', path: `${workspace}/team`, fixture: memberOfTwo },
  { stories: 'HU-018 · role catalog', path: `${workspace}/team/roles`, fixture: memberOfTwo },
  {
    stories: 'HU-015 / HU-016 · issued invitations',
    path: `${workspace}/team/invitations`,
    fixture: memberOfTwo,
  },
  {
    stories: 'HU-014 · invite a teammate',
    path: `${workspace}/team/invitations/new`,
    fixture: memberOfTwo,
  },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`accessibility · ${viewport.name}`, () => {
    for (const screen of SCREENS) {
      test(`${screen.stories}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await installStudioApiMock(page, screen.fixture())
        await page.goto(screen.path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await screen.reveal?.(page)

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
      await page.setViewportSize({ width: 390, height: 844 })
      await installStudioApiMock(page, screen.fixture())
      await page.goto(screen.path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await screen.reveal?.(page)

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }))
      expect(overflow.document, `${screen.stories} overflows horizontally`).toBeLessThanOrEqual(
        overflow.viewport,
      )

      // One h1 per screen: the audit brief asks for visual hierarchy, and a
      // page with zero or several top-level headings has none to speak of.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    })
  }
})
