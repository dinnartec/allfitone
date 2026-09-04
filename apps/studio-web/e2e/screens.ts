/**
 * Every screen of the fourteen implemented Studio user stories, shared by the
 * suites that sweep all of them: the accessibility audit, the mobile layout
 * check and the Design System contract.
 *
 * A screen is what a person can be looking at, not a route. Most of these live
 * as states of a machine inside one route — `/` alone renders nine of them — so
 * counting `page.tsx` files undercounts the surface an audit has to cover.
 *
 * Kept in one place so a new screen is declared once and every sweep picks it
 * up, rather than three lists drifting apart.
 */
import { expect, type Page } from '@playwright/test'

import {
  TEST_ANALYTICS_ID,
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  professionalCredential,
  professionalProfile,
  secondActiveMembership,
  terminatedMembership,
  type StudioApiFixture,
} from './studio-api-mock'

export interface Viewport {
  name: string
  width: number
  height: number
}

export const DESKTOP: Viewport = { name: 'desktop', width: 1440, height: 900 }
export const MOBILE: Viewport = { name: 'mobile', width: 390, height: 844 }

export interface Screen {
  stories: string
  path: string
  fixture: () => StudioApiFixture
  /** Runs before the mock is installed — seeding storage a screen reads on load. */
  setup?: (page: Page) => Promise<void>
  /**
   * Proves the screen is on the page. Defaults to a level-1 heading, which is
   * wrong for a spinner stage, so those declare their own.
   */
  settled?: (page: Page) => Promise<void>
  /** Interaction needed to reach the screen once the route has loaded. */
  reveal?: (page: Page) => Promise<void>
  /** Pins a screen that only exists at one width, such as the mobile card list. */
  viewport?: Viewport
  /**
   * False for stages that legitimately carry no heading — a spinner announces
   * itself through a live region instead, and demanding an h1 there would be
   * asserting a hierarchy the screen has no content to build.
   */
  hasHeading?: boolean
}

async function settledByHeading(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** Arranges a screen and waits until it is really on the page. */
export async function openScreen(page: Page, screen: Screen, viewport: Viewport): Promise<void> {
  await page.setViewportSize(screen.viewport ?? { width: viewport.width, height: viewport.height })
  await screen.setup?.(page)
  await installStudioApiMock(page, screen.fixture())
  await page.goto(screen.path)
  await (screen.settled ?? settledByHeading)(page)
  await screen.reveal?.(page)
}

const workspace = `/organizations/${activeMembership.organization_id}`

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

/** Holds one endpoint open so a pending stage can be audited before it resolves. */
const stall = (path: string) => () =>
  createStudioApiFixture({
    intercept: async (request) => {
      if (request.path === path) await new Promise((resolve) => setTimeout(resolve, 15_000))
      return undefined
    },
  })

const failing = (path: string, status: number, code: string) => () =>
  createStudioApiFixture({
    intercept: (request) => (request.path === path ? { status, body: error(code) } : undefined),
  })

export const SCREENS: Screen[] = [
  // --- `/` · StudioEntry renders nine screens through one state machine -------
  {
    stories: 'entry · resolving the account',
    path: '/',
    fixture: stall('/studio/v1/entry-context'),
    hasHeading: false,
    settled: async (page) => {
      await expect(page.getByText('Preparando tu espacio…')).toBeVisible()
    },
  },
  {
    stories: 'HU-001 · access landing',
    path: '/',
    fixture: () => createStudioApiFixture({ signedOut: true }),
  },
  {
    stories: 'entry · personal activation',
    path: '/',
    fixture: () =>
      createStudioApiFixture({
        session: {
          authenticated: true,
          registration_status: 'registration_incomplete',
          identity: { given_name: 'Ada', family_name: 'Lovelace' },
          analytics: { distinct_id: TEST_ANALYTICS_ID },
        },
      }),
  },
  {
    stories: 'HU-007 · how do you work today',
    path: '/',
    fixture: createStudioApiFixture,
  },
  {
    stories: 'HU-007 · name your independent space',
    path: '/',
    fixture: createStudioApiFixture,
    reveal: async (page) => {
      await page.getByRole('button', { name: /Trabajo por mi cuenta/ }).click()
      await expect(page.getByLabel('Nombre visible')).toBeVisible()
    },
  },
  {
    stories: 'HU-007 · the space is ready',
    path: '/',
    fixture: createStudioApiFixture,
    reveal: async (page) => {
      await page.getByRole('button', { name: /Trabajo por mi cuenta/ }).click()
      await page.getByLabel('Nombre visible').fill('Estudio de Ada')
      await page.getByRole('button', { name: 'Crear mi espacio' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: /Tu espacio está listo/ }),
      ).toBeVisible()
    },
  },
  {
    stories: 'entry · waiting for an invitation',
    path: '/',
    fixture: createStudioApiFixture,
    reveal: async (page) => {
      await page.getByRole('button', { name: /Esperar una invitación/ }).click()
    },
  },
  {
    stories: 'HU-004 · choose where to work today',
    path: '/',
    fixture: () =>
      createStudioApiFixture({ memberships: [activeMembership, secondActiveMembership] }),
  },
  {
    stories: 'entry · the identity service is unreachable',
    path: '/',
    fixture: failing('/studio/v1/entry-context', 503, 'upstream-unavailable'),
  },

  // --- the rest ---------------------------------------------------------------
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
