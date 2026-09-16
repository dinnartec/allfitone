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

/**
 * The overview renders whatever it was given, so an h1 is no evidence that the
 * load it was meant to carry arrived. The invitations register was swept
 * against its own failure state for exactly this reason: it had a heading.
 */
async function settledByLoadedOverview(page: Page): Promise<void> {
  await settledByHeading(page)
  await expect(page.getByRole('heading', { name: 'Requiere atención' })).toBeVisible()
  await expect(page.locator('[data-overview-team-list] > li')).toHaveCount(5)
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
/**
 * The mock answers only POST on the invitations collection, so a GET falls
 * through to a 500 and the section renders its failure state. Auditing the two
 * stories about *reading* invitations against a screen that never showed one is
 * how this looked covered while covering nothing.
 */
const issuedInvitation = (id: string, status: string, expires_at: string) => ({
  id,
  status,
  channel: 'email',
  contact: `${id}@example.test`,
  created_at: '2026-09-01T00:00:00.000Z',
  expires_at,
  intents: [{ id: `${id}-intent`, kind: 'membership', status, proposed_role_code: 'staff' }],
})

const withIssuedInvitations = () =>
  createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership, terminatedMembership],
    intercept: (request) =>
      request.method === 'GET' && /\/invitations(\?|$)/.test(request.path)
        ? {
            status: 200,
            body: {
              data: [
                issuedInvitation('pendiente', 'pending', '2030-09-20T00:00:00.000Z'),
                issuedInvitation('decidida', 'completed', '2026-09-18T00:00:00.000Z'),
                issuedInvitation('revocada', 'revoked', '2026-09-15T00:00:00.000Z'),
                issuedInvitation('vencida', 'expired', '2026-08-30T00:00:00.000Z'),
              ],
              page: { next_cursor: null },
            },
          }
        : undefined,
  })

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

const overviewMember = (id: string, display_name: string, joined_at: string, roles: string[]) => ({
  membership_id: id,
  display_name,
  status: 'active',
  joined_at,
  ended_at: null,
  roles,
})

/**
 * A workspace with something in it. The default fixture gives the overview one
 * active member and a 500 on the invitations GET, so the three sweeps had only
 * ever seen the emptiest version of the first screen a person lands on: no
 * "Requiere atención" card at all, and a recent-team list of one row that
 * cannot show what five rows do to a phone.
 */
const withOverviewLoad = () =>
  createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership, terminatedMembership],
    organizationMemberships: [
      overviewMember('ov-1', 'Alejandro Rangel Buitrago', '2026-09-07T00:00:00.000Z', [
        'owner',
        'admin',
      ]),
      overviewMember('ov-2', 'María Fernanda Quintero', '2026-09-05T00:00:00.000Z', ['admin']),
      overviewMember('ov-3', 'Jo Li', '2026-08-30T00:00:00.000Z', ['coach']),
      overviewMember('ov-4', 'Bartholomew Featherstonehaugh', '2026-08-21T00:00:00.000Z', [
        'staff',
        'coach',
      ]),
      overviewMember('ov-5', 'Camila Torres', '2026-07-14T00:00:00.000Z', ['staff']),
    ],
    intercept: (request) =>
      request.method === 'GET' && /\/invitations(\?|$)/.test(request.path)
        ? {
            status: 200,
            body: {
              // Relative, not fixed: the attention card only appears for a
              // pending invitation expiring within seven days of now, so a
              // literal date would quietly stop rendering the card it exists
              // to cover on the day it passed.
              data: [
                issuedInvitation('proxima', 'pending', inDays(2)),
                issuedInvitation('siguiente', 'pending', inDays(4)),
              ],
              page: { next_cursor: null },
            },
          }
        : undefined,
  })

/**
 * The verification failure as an overlay rather than a page. The workspace had
 * already loaded, so the alert covers blurred content that must stay out of
 * reach — different markup from `organization · the access check failed`, which
 * replaces the page and was the only one of the two being swept.
 *
 * The first membership check succeeds and every later one fails, which is what
 * a revalidation against an unreachable API looks like.
 */
const withFailingRevalidation = () => {
  let checks = 0
  return createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (request.method !== 'GET' || request.path !== '/studio/v1/me/memberships') return undefined
      checks += 1
      return checks > 1 ? { status: 503, body: error('upstream-unavailable') } : undefined
    },
  })
}

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

const SESSION_STORAGE_KEY = 'allfit-studio-session:v1'

/**
 * Seeds the locally ended session the guard finds on load. Which screen it then
 * shows depends on what the API answers when it verifies: a session still alive
 * locks the recovery closed, an unreachable one leaves the retry open.
 */
const endedSession = (reason: 'manual' | 'inactivity') => async (page: Page) => {
  await page.addInitScript(
    ([key, record]) => {
      localStorage.setItem(key, record)
    },
    [
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, status: 'ended', endedAt: Date.now(), reason }),
    ] as const,
  )
}

/** Holds the guard's recovery verification open so a session screen stays put. */
const withStalledVerification = () =>
  createStudioApiFixture({
    memberships: [activeMembership],
    intercept: async (request) => {
      if (request.path === '/studio/v1/session') {
        await new Promise((resolve) => setTimeout(resolve, 15_000))
      }
      return undefined
    },
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
  /** No space yet, so accepting is a setup step and the screen shows the bar. */
  newPerson?: boolean
  /** No session: the invitation still resolves, but deciding needs a sign-in. */
  signedOut?: boolean
  /**
   * An organization Allfit hands over (AFO-214) rather than a team invitation.
   * The same route and the same token: the page asks for a team invitation
   * first, so this makes that one answer 404 and the ownership one resolve.
   */
  ownership?: boolean
}

const ownershipPresentation = {
  id: INVITATION_ID,
  organization: {
    id: activeMembership.organization_id,
    display_name: activeMembership.display_name,
    type_name: 'Gimnasio',
    party_kind: 'legal_entity',
    legal_name: 'Norte Fitness SAS',
    site_name: 'Sede Principal',
  },
  expires_at: '2030-09-20T12:00:00.000Z',
  intent: { id: INTENT_ID, status: 'pending' },
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
    signedOut: Boolean(options.signedOut),
    memberships: options.newPerson ? [] : [activeMembership],
    intercept: async (request) => {
      if (request.path === '/studio/v1/invitations/resolve') {
        if (options.stallResolve) await new Promise((resolve) => setTimeout(resolve, 15_000))
        // A team token is tried first, so an ownership one has to be refused
        // here before the page will ask about it.
        if (options.ownership) return { status: 404, body: error('not-found') }
        return options.resolve ?? { status: 200, body: invitationPresentation }
      }
      if (request.path === '/studio/v1/ownership-invitations/resolve') {
        return { status: 200, body: ownershipPresentation }
      }
      if (request.path === '/studio/v1/ownership-invitations/decisions') {
        const decision = options.decisionOutcome ?? 'accepted'
        return {
          status: 200,
          body: {
            invitation_id: INVITATION_ID,
            invitation_status: 'completed',
            organization_id: activeMembership.organization_id,
            intent: { id: INTENT_ID, status: decision },
            replayed: false,
          },
        }
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
    // The team choice leads somewhere else entirely: a type selector, a radio
    // group and a conditional field the independent form never renders.
    stories: 'HU-007 · name your team space',
    path: '/',
    fixture: createStudioApiFixture,
    reveal: async (page) => {
      await page.getByRole('button', { name: /Tengo un equipo o centro/ }).click()
      await expect(page.getByLabel('Nombre visible')).toBeVisible()
    },
  },
  {
    // Choosing an entity reveals a required field the natural-person path never
    // shows, so this is a screen of its own rather than the same one toggled.
    stories: 'HU-007 · name your team space for an entity',
    path: '/',
    fixture: createStudioApiFixture,
    reveal: async (page) => {
      await page.getByRole('button', { name: /Tengo un equipo o centro/ }).click()
      await page.getByRole('radio', { name: 'Entidad' }).click()
      await expect(page.getByLabel('Nombre legal de la entidad')).toBeVisible()
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
    // What an invitee with no session sees — the "Entrar para decidir" view.
    // Every other invitation screen here was swept signed in, so the first thing
    // a person without an account meets had never been through any of the sweeps.
    stories: 'HU-085 / HU-086 · decide on a team invitation before signing in',
    path: invitationWithToken,
    fixture: () => invitationFixture({ signedOut: true }),
    // An h1 proves nothing here: the organization name is the heading whether or
    // not a session exists. Only the signed-out view offers this action.
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByRole('link', { name: 'Entrar para decidir' })).toBeVisible()
    },
  },
  {
    // The same screen for someone with no space yet: accepting is their second
    // setup step, so it carries the progress bar the member's version does not.
    stories: 'HU-085 / HU-086 · decide on a team invitation as a new person',
    path: invitationWithToken,
    fixture: () => invitationFixture({ newPerson: true }),
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
  {
    // The same stage carries a different message after too many attempts, and
    // only that one tells the person to wait rather than retry.
    stories: 'invitation · too many attempts to open the invitation',
    path: invitationWithToken,
    fixture: () => invitationFixture({ resolve: { status: 429, body: error('rate-limited') } }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText(/Se hicieron demasiados intentos/)).toBeVisible()
    },
  },

  // --- the same route, for an organization Allfit hands over (AFO-214) --------
  // These arrived from `main` after the inventory was closed, so nothing had
  // swept them. Reviewing them found the faults the team panel had already had:
  // a title that ran five lines, and a summary list with no styling at all.
  {
    stories: 'AFO-214 · receive an organization Allfit hands over',
    path: invitationWithToken,
    fixture: () => invitationFixture({ ownership: true }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByRole('button', { name: /Aceptar y recibir/ })).toBeVisible()
    },
  },
  {
    stories: 'AFO-214 · receive an organization before signing in',
    path: invitationWithToken,
    fixture: () => invitationFixture({ ownership: true, signedOut: true }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByRole('link', { name: 'Entrar para decidir' })).toBeVisible()
    },
  },
  {
    // The rejection stage is shared with team invitations but says something
    // else: the organization stays, and stays shut.
    stories: 'AFO-214 · the handover was declined',
    path: invitationWithToken,
    fixture: () => invitationFixture({ ownership: true, decisionOutcome: 'rejected' }),
    reveal: async (page) => {
      await page.getByRole('button', { name: /Aceptar y recibir/ }).waitFor()
      await page.getByRole('button', { name: 'Rechazar' }).click()
      await expect(page.getByText(/sigue sin operar/)).toBeVisible()
    },
  },

  // --- `/organizations/[id]` · the workspace and the states that replace it ---
  { stories: 'HU-004 / HU-006 · workspace and memberships', path: workspace, fixture: memberOfTwo },
  {
    stories: 'HU-004 · workspace with a team and invitations to attend',
    path: workspace,
    fixture: withOverviewLoad,
    settled: settledByLoadedOverview,
  },
  {
    // The recent-team row stacks below 640px, and a single-member workspace
    // cannot show whether five stacked rows still read as five people.
    stories: 'HU-004 · workspace with a team and invitations on a phone',
    path: workspace,
    fixture: withOverviewLoad,
    viewport: MOBILE,
    settled: settledByLoadedOverview,
  },
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
  {
    stories: 'organization · the access check failed over a loaded workspace',
    path: workspace,
    fixture: withFailingRevalidation,
    settled: async (page) => {
      await settledByHeading(page)
      // The context revalidates on pageshow, but ignores one within a second
      // of the last verification.
      await page.waitForTimeout(1100)
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
      await expect(page.getByText('No pudimos comprobar tu acceso')).toBeVisible()
    },
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
    fixture: withIssuedInvitations,
  },
  {
    // Six columns do not fit a phone, so the register renders as cards below
    // 720px — separate markup, like the directory's, not one behind a toggle.
    stories: 'HU-015 / HU-016 · issued invitations as cards',
    path: `${workspace}/team/invitations`,
    fixture: withIssuedInvitations,
    viewport: MOBILE,
  },
  {
    stories: 'HU-014 · invite a teammate',
    path: `${workspace}/team/invitations/new`,
    fixture: memberOfTwo,
  },

  // --- the two screens the framework used to answer for us -------------------
  {
    // Reachable by a typo, a stale bookmark or an old link. Until this screen
    // existed Next answered with its own unstyled English page.
    stories: 'entry · an address that matches no screen',
    path: '/una-direccion-que-no-existe',
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: 'Esta página no existe' }),
      ).toBeVisible()
    },
  },
  {
    // A payload the screen dereferences while rendering, which is what an error
    // boundary is for. Without one the framework answered here too.
    stories: 'entry · a screen that failed while rendering',
    path: invitationWithToken,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        intercept: (request) =>
          request.path === '/studio/v1/invitations/resolve'
            ? { status: 200, body: { id: 'x', status: 'pending', organization: null, intents: [] } }
            : undefined,
      }),
    settled: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: 'No pudimos mostrar esta página' }),
      ).toBeVisible()
    },
  },

  // --- HU-002 · the screens the session guard puts in front of the app --------
  // `session-logout.spec.ts` proves all five behave correctly, but none of them
  // had ever gone through the three sweeps. One entry per rendering: the end
  // reason swaps a single sentence and nothing else a sweep can measure, and
  // that wording is already asserted per reason in the spec.
  {
    stories: 'HU-002 · the remote logout could not be confirmed',
    path: '/?logout=partial',
    fixture: () => createStudioApiFixture({ signedOut: true }),
    settled: async (page) => {
      await expect(page.getByText('La sesión se cerró en este equipo')).toBeVisible()
    },
  },
  {
    stories: 'HU-002 · closing your session in this tab',
    path: workspace,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    // The workspace keeps its heading but goes `inert`, which withdraws it from
    // the accessibility tree on purpose. Demanding a heading here would be
    // demanding the screen expose what it is deliberately hiding; the live
    // region carrying "Cerrando tu sesión…" is what speaks for this state.
    hasHeading: false,
    reveal: async (page) => {
      // The logout POST *is* the navigation away, so neutralising the submit is
      // what holds this state on screen long enough to measure it.
      await page.evaluate(() => {
        HTMLFormElement.prototype.submit = function holdLogout() {
          document.documentElement.dataset.logoutPending = 'true'
        }
      })
      // Below the sidebar's breakpoint the control lives inside the collapsed
      // navigation, so reaching it is one click further on a phone.
      const logout = page.getByRole('button', { name: 'Cerrar sesión' })
      if (!(await logout.isVisible())) {
        await page.getByRole('button', { name: 'Abrir o cerrar navegación' }).click()
        await expect(logout).toBeVisible()
      }
      await logout.click()
      await expect(page.getByRole('status')).toHaveText('Cerrando tu sesión…')
    },
  },
  {
    stories: 'HU-002 · the session was closed in another tab',
    path: workspace,
    fixture: withStalledVerification,
    reveal: async (page) => {
      await page.evaluate((key) => {
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, status: 'ended', endedAt: Date.now(), reason: 'manual' }),
        )
        // Writing storage from the tab that owns it fires no event, so the guard's
        // cross-tab listener has to be handed the one the browser sends elsewhere.
        window.dispatchEvent(new StorageEvent('storage', { key }))
      }, SESSION_STORAGE_KEY)
      await expect(page.locator('[data-session-closing]')).toBeVisible()
    },
  },
  {
    stories: 'HU-002 · complete the close before signing in again',
    path: workspace,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    setup: endedSession('manual'),
    settled: async (page) => {
      await expect(page.getByRole('heading', { name: 'Tu sesión está protegida' })).toBeVisible()
    },
  },
  {
    stories: 'HU-002 · the close could not be verified',
    path: workspace,
    fixture: failing('/studio/v1/session', 503, 'upstream-unavailable'),
    setup: endedSession('inactivity'),
    settled: async (page) => {
      await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    },
  },
]
