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
   * The mock seeds a denied analytics decision by default, so every screen
   * renders the collapsed privacy control. `undecided` leaves the consent panel
   * open instead — the state a person meets on their very first visit.
   */
  consent?: 'denied' | 'undecided'
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
  await installStudioApiMock(
    page,
    screen.fixture(),
    screen.consent ? { consent: screen.consent } : {},
  )
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

const withoutProfile = () =>
  createStudioApiFixture({
    me: { profile: null, memberships: [activeMembership] },
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

/**
 * `/invitations` reads its token from the URL fragment, which a beforeInteractive
 * script moves into sessionStorage and wipes before anything renders. Navigating
 * with the fragment is therefore the real way in — no storage seeding required.
 */
const INVITATION_TOKEN = 'A'.repeat(43)
const INVITATION_ID = '01991600-7000-7000-8000-000000000201'
const INTENT_ID = '01991600-7000-7000-8000-000000000202'
const invitationWithToken = `/invitations#token=${INVITATION_TOKEN}`

const invitationPresentation = {
  id: INVITATION_ID,
  status: 'pending',
  organization: {
    id: activeMembership.organization_id,
    display_name: activeMembership.display_name,
    responsible_party: { kind: 'natural_person', name: 'Ada Owner' },
  },
  expires_at: '2030-08-18T12:00:00.000Z',
  intents: [{ id: INTENT_ID, kind: 'membership', status: 'pending', proposed_role_code: 'staff' }],
}

interface InvitationOptions {
  stallResolve?: boolean
  registrationIncomplete?: boolean
  resolve?: { status: number; body: unknown }
  decision?: { status: number; body: unknown }
  decisionOutcome?: 'accepted' | 'rejected'
}

function invitationFixture(options: InvitationOptions = {}): StudioApiFixture {
  const session = {
    authenticated: true,
    registration_status: options.registrationIncomplete ? 'registration_incomplete' : 'complete',
    identity: { given_name: 'Ada', family_name: 'Lovelace' },
    analytics: { distinct_id: TEST_ANALYTICS_ID },
  }

  return createStudioApiFixture({
    session,
    memberships: [activeMembership],
    intercept: async (request) => {
      if (request.path === '/studio/v1/invitations/resolve') {
        if (options.stallResolve) await new Promise((resolve) => setTimeout(resolve, 15_000))
        return options.resolve ?? { status: 200, body: invitationPresentation }
      }
      if (request.path === '/studio/v1/invitations/decisions') {
        if (options.decision) return options.decision
        const decision = options.decisionOutcome ?? 'accepted'
        return {
          status: 200,
          body: {
            invitation_id: INVITATION_ID,
            invitation_status: 'completed',
            organization_id: activeMembership.organization_id,
            intent: {
              id: INTENT_ID,
              kind: 'membership',
              status: decision,
              proposed_role_code: 'staff',
              membership_id: decision === 'accepted' ? activeMembership.membership_id : null,
            },
            replayed: false,
          },
        }
      }
      return undefined
    },
  })
}

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
    // Every other screen renders the collapsed privacy control because the mock
    // seeds a denied decision. The open panel is what a first-time visitor
    // actually meets, and until now nothing had measured it.
    stories: 'privacy · the consent panel on a first visit',
    path: '/',
    fixture: () => createStudioApiFixture({ signedOut: true }),
    consent: 'undecided',
    settled: async (page) => {
      await expect(page.getByText('Analítica opcional')).toBeVisible()
    },
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

  // --- `/invitations` · TeamInvitationDecision renders seven screens ----------
  {
    stories: 'invitation · consulting the invitation',
    path: invitationWithToken,
    fixture: () => invitationFixture({ stallResolve: true }),
    hasHeading: false,
    settled: async (page) => {
      await expect(page.getByText('Consultando la invitación…')).toBeVisible()
    },
  },
  {
    stories: 'HU-085 / HU-086 · decide on a team invitation',
    path: invitationWithToken,
    fixture: () => invitationFixture(),
  },
  {
    stories: 'invitation · activate the identity first',
    path: invitationWithToken,
    fixture: () => invitationFixture({ registrationIncomplete: true }),
  },
  {
    stories: 'HU-085 · the invitation is no longer available',
    path: '/invitations',
    fixture: () => invitationFixture(),
  },
  {
    stories: 'HU-086 · the invitation was sent to another account',
    path: invitationWithToken,
    fixture: () => invitationFixture({ decision: { status: 403, body: error('forbidden') } }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Rechazar' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: /enviada a otra cuenta/ }),
      ).toBeVisible()
    },
  },
  {
    stories: 'HU-086 · the invitation was rejected',
    path: invitationWithToken,
    fixture: () => invitationFixture({ decisionOutcome: 'rejected' }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Rechazar' }).click()
      await expect(page.getByRole('heading', { level: 1, name: /Rechazaste/ })).toBeVisible()
    },
  },
  {
    stories: 'invitation · the invitation could not be opened',
    path: invitationWithToken,
    fixture: () => invitationFixture({ resolve: { status: 503, body: error('unavailable') } }),
  },

  // --- `/organizations/[id]` · the workspace and the states that replace it ---
  { stories: 'HU-004 / HU-006 · workspace and memberships', path: workspace, fixture: memberOfTwo },
  {
    // A coach reads neither the directory nor the invitation register, so the
    // overview has nothing to count and orientation is the honest content.
    stories: 'HU-018 · orientation for a role that reads nothing',
    path: `/organizations/${secondActiveMembership.organization_id}`,
    fixture: () => createStudioApiFixture({ memberships: [secondActiveMembership] }),
  },
  {
    stories: 'organization · verifying your access',
    path: workspace,
    fixture: stall('/studio/v1/me/memberships'),
    hasHeading: false,
    settled: async (page) => {
      await expect(page.getByText('Comprobando tu acceso…')).toBeVisible()
    },
  },
  {
    stories: 'organization · the membership was revoked',
    path: workspace,
    fixture: failing('/studio/v1/me/memberships', 403, 'forbidden'),
  },
  {
    stories: 'organization · the access check failed',
    path: workspace,
    fixture: failing('/studio/v1/me/memberships', 500, 'upstream-error'),
  },

  // --- `/account` · one route, five views -------------------------------------
  { stories: 'HU-005 · professional profile', path: '/account', fixture: withProfile },
  {
    stories: 'HU-005 · declared credentials',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales opcionales' }).click()
    },
  },
  {
    stories: 'HU-006 · my spaces',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Mis espacios' }).click()
      await expect(page.getByText('Espacios activos')).toBeVisible()
    },
  },
  {
    // HU-005 keeps professional setup dormant until the person opts in.
    stories: 'HU-005 · professional setup is dormant',
    path: '/account',
    fixture: withoutProfile,
  },
  {
    stories: 'HU-005 · configure the professional profile',
    path: '/account',
    fixture: withoutProfile,
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Configurar perfil profesional' }).click()
      await expect(
        page.getByRole('heading', { name: 'Configura tu perfil profesional' }),
      ).toBeVisible()
    },
  },

  // --- the team section -------------------------------------------------------
  { stories: 'HU-017 · team directory', path: `${workspace}/team`, fixture: memberOfTwo },
  {
    // Below 720px the directory renders a card list instead of the table, and
    // the two are separate markup rather than one behind a CSS toggle.
    stories: 'HU-017 · team directory as cards',
    path: `${workspace}/team`,
    fixture: memberOfTwo,
    viewport: MOBILE,
  },
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
