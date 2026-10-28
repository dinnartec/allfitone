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
  activeCoach,
  activeMembership,
  activeTeamMember,
  coachedTeam,
  createStudioApiFixture,
  organizationWithLongSite,
  organizationWithoutSites,
  error,
  installStudioApiMock,
  professionalCredential,
  endedRelationshipState,
  professionalProfile,
  holderMembership,
  relationshipState,
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
  await settleAnimations(page)
}

/**
 * Audit the frame a person reads, not one on the way to it. A dialog is
 * "visible" to Playwright the instant it has a box, while its entrance is still
 * at `opacity: 0`, and axe composites the text against whatever shows through:
 * the revocation dialog reported 4.30:1 mid-fade and passes once it lands.
 *
 * Endless animations — the spinner, the skeleton shimmer — are skipped, because
 * a loading screen would otherwise never settle.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .every((animation) => animation.playState !== 'running'),
  )
}

const workspace = `/organizations/${activeMembership.organization_id}`
const relationshipId = relationshipState.relationship_id

/** Una corriendo y dos terminadas: el vínculo que ya acumuló historia. */
function coversWithHistory() {
  const cover = (id: string, name: string, status: string, from: string, to: string) => ({
    assignment_id: id,
    membership_id: '01991600-7000-7000-8000-000000000003',
    professional_person_id: '01991600-7000-7000-8000-000000000203',
    display_name: name,
    status,
    valid_from: from,
    ends_on: to,
    accepted_by_person_at: from,
  })
  return {
    ...relationshipState,
    substitutions: [
      cover(
        '01991600-7000-7000-8000-000000000420',
        'Daniela Hoyos',
        'ended',
        '2026-03-01T00:00:00.000Z',
        '2026-03-12',
      ),
      cover(
        '01991600-7000-7000-8000-000000000421',
        'Sara Posada',
        'active',
        '2026-01-10T00:00:00.000Z',
        '2026-12-20',
      ),
      cover(
        '01991600-7000-7000-8000-000000000422',
        'Elena Soto',
        'ended',
        '2026-08-05T00:00:00.000Z',
        '2026-08-19',
      ),
    ],
  }
}

/** The fixture's cover is `proposed`; this one is actually running. */
function runningCover() {
  return {
    ...relationshipState,
    substitutions: [
      {
        assignment_id: '01991600-7000-7000-8000-000000000402',
        membership_id: '01991600-7000-7000-8000-000000000003',
        professional_person_id: '01991600-7000-7000-8000-000000000203',
        display_name: 'Daniela Hoyos',
        status: 'active',
        valid_from: '2026-10-10T00:00:00.000Z',
        ends_on: '2026-10-24',
        accepted_by_person_at: '2026-10-09T18:00:00.000Z',
      },
    ],
  }
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

const withoutProfile = () =>
  createStudioApiFixture({
    me: { profile: null, memberships: [activeMembership] },
    memberships: [activeMembership],
  })

const withProfileAndNoCredentials = () =>
  createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [] },
      memberships: [activeMembership],
    },
    memberships: [activeMembership],
  })

/** Every space this person had has ended, which is not the same as never having one. */
const withoutActiveSpaces = () =>
  createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [professionalCredential] },
      memberships: [terminatedMembership],
    },
    memberships: [activeMembership],
  })

const asCoach = () => createStudioApiFixture({ memberships: [secondActiveMembership] })

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

/** A read that never answers, for a person who is already a member. */
const stallingFor = (memberships: StudioApiFixture['memberships'], paths: RegExp) => () =>
  createStudioApiFixture({
    memberships,
    intercept: async (request) => {
      if (request.method === 'GET' && paths.test(request.path)) {
        await new Promise((resolve) => setTimeout(resolve, 15_000))
      }
      return undefined
    },
  })

/**
 * The same outage, for a person who is already a member: the failure has to sit
 * behind a session that resolves, or the screen under audit never renders.
 *
 * 503 rather than 500 because `shouldRetryStudioQuery` retries only that one,
 * which is what a person meets during a real outage. An always-failing path
 * covers both attempts.
 */
const failingFor = (memberships: StudioApiFixture['memberships'], paths: RegExp) => () =>
  createStudioApiFixture({
    memberships,
    intercept: (request) =>
      request.method === 'GET' && paths.test(request.path)
        ? { status: 503, body: error('upstream-unavailable') }
        : undefined,
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
    // The link outlives its window. The form stays on screen with its submit
    // disabled, so the person can read why nothing they type will be accepted.
    stories: 'entry · the activation window closed',
    path: '/',
    fixture: () =>
      createStudioApiFixture({
        session: {
          authenticated: true,
          registration_status: 'registration_incomplete',
          identity: { given_name: 'Ada', family_name: 'Lovelace' },
          analytics: { distinct_id: TEST_ANALYTICS_ID },
        },
        intercept: (request) =>
          request.method === 'POST' && request.path === '/studio/v1/onboarding-attempts'
            ? {
                status: 201,
                body: {
                  id: '01991600-4000-7000-8000-000000000001',
                  status: 'open',
                  eligibility_status: 'unknown',
                  expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                  terms_version: 'platform_terms_v1',
                  privacy_notice_version: 'privacy_notice_v1',
                },
              }
            : undefined,
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('La activación venció')).toBeVisible()
    },
  },
  {
    // The waiting panel checks on demand rather than polling, so its failure is
    // the only one in the product a person provokes by pressing a button.
    stories: 'entry · the membership check did not finish',
    path: '/',
    fixture: () =>
      createStudioApiFixture({
        intercept: (request) =>
          request.method === 'GET' && request.path === '/studio/v1/me/memberships'
            ? { status: 503, body: error('upstream-unavailable') }
            : undefined,
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: /Esperar una invitación/ }).click()
      await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()
      await expect(page.getByText('La comprobación no terminó')).toBeVisible()
    },
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
    // A 403 and a 404 each mean something the person can act on, so they get
    // their own screens. Everything else lands here, with the decision unmade.
    stories: 'HU-085 · the decision could not be saved',
    path: invitationWithToken,
    fixture: () => invitationFixture({ decision: { status: 503, body: error('unavailable') } }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Aceptar invitación' }).click()
      await expect(page.getByText('No pudimos guardar tu decisión')).toBeVisible()
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
    // The workspace of someone whose organization is still only them.
    stories: 'HU-004 · workspace with nobody else in the team',
    path: workspace,
    fixture: () =>
      createStudioApiFixture({ memberships: [activeMembership], organizationMemberships: [] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Trabajas en solitario por ahora')).toBeVisible()
    },
  },
  {
    // The overview counts two registers. It reports the outage only when it has
    // neither, which is why both reads fail here rather than one.
    stories: 'HU-004 · the workspace could not read its own registers',
    path: workspace,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/(memberships|invitations)$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar el estado de tu organización')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients` · HU-024 ---
  {
    // Both kinds of entry on one screen: two people who accepted and one who
    // has not answered. The unanswered one has no name at all, which is the
    // part worth looking at.
    stories: 'HU-024 · the client directory with people and an unanswered invitation',
    path: `${workspace}/clients`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      // `exact`, or it also matches the "Invitados" filter button.
      await expect(page.getByText('Invitado', { exact: true })).toBeVisible()
    },
  },
  {
    // The filter that only shows what nobody answered. The masked contact here
    // is deliberately long and has nowhere to break, which is the shape that
    // painted over its neighbour the last time.
    stories: 'HU-024 · only the invitations nobody answered',
    path: `${workspace}/clients`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Invitados' }).click()
      await expect(page.getByText(/correo-institucional-muy-largo/)).toBeVisible()
    },
  },
  {
    stories: 'HU-024 · a directory with nobody in it yet',
    path: `${workspace}/clients`,
    fixture: () =>
      createStudioApiFixture({ memberships: [activeMembership], organizationClients: [] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Todavía no hay personas vinculadas')).toBeVisible()
    },
  },
  {
    // A coach reads a directory too — their own. The wording has to say so, or
    // a short list reads as clients gone missing.
    stories: 'HU-024 · the directory a coach reads',
    path: `/organizations/${secondActiveMembership.organization_id}/clients`,
    fixture: () => createStudioApiFixture({ memberships: [secondActiveMembership] }),
  },
  {
    stories: 'HU-024 · the directory could not be read',
    path: `${workspace}/clients`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/clients$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar los clientes')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients/[relationshipId]` · HU-025 ---
  {
    // The fullest the screen gets: a holder, a substitution nobody has answered
    // yet, and three permissions in three different states. If any of these
    // crowd each other, this is where it shows.
    stories: 'HU-025 · how a relationship stands, with permissions in three states',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Camilo Restrepo')).toBeVisible()
      await expect(page.getByText('Retirado')).toBeVisible()
    },
  },
  {
    // The relationship after it ended: that is the only state where a permission
    // is frozen, which is what "Sin nuevos datos" names. It is also the only
    // place the end date appears.
    stories: 'HU-025 · a relationship that ended, and the permissions it froze',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        relationshipState: endedRelationshipState,
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Sin nuevos datos').first()).toBeVisible()
      await expect(page.getByText('Finalización')).toBeVisible()
    },
  },
  {
    // Nobody in charge and nothing granted. Both are legitimate states, and the
    // screen has to read as a state rather than as a failure.
    stories: 'HU-025 · a relationship with no professional and no permissions',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        relationshipState: {
          ...relationshipState,
          holder: null,
          substitutions: [],
          grants: [],
        },
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Nadie la atiende todavía')).toBeVisible()
      await expect(page.getByText('No concedió ningún permiso')).toBeVisible()
    },
  },
  {
    // HU-027. The form only exists where the command would succeed: a live
    // relationship with nobody in charge, read by somebody who may assign.
    stories: 'HU-027 · choosing the professional for a client nobody attends',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, holder: null, substitutions: [] },
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Asignar no concede datos')).toBeVisible()
    },
  },
  {
    // The list open, which is the widest the panel ever gets and the state that
    // paints over whatever sits under it when it does not fit.
    stories: 'HU-027 · the coaches a client can be assigned to',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, holder: null, substitutions: [] },
      }),
    reveal: async (page) => {
      await page.getByRole('combobox', { name: 'Profesional responsable' }).click()
      await expect(page.getByRole('option', { name: 'Camilo Restrepo' })).toBeVisible()
    },
  },
  {
    // Somebody else got there first. A conflict, not an outage: the reader can
    // see what happened and what to do, so it is said in the field.
    stories: 'HU-027 · somebody else was assigned while the page was open',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, holder: null, substitutions: [] },
        assignmentOutcome: 'taken',
      }),
    reveal: async (page) => {
      await page.getByRole('combobox', { name: 'Profesional responsable' }).click()
      await page.getByRole('option', { name: 'Camilo Restrepo' }).click()
      await page.getByRole('button', { name: 'Asignar' }).click()
      await expect(page.getByText(/Alguien lo asignó mientras tenías/)).toBeVisible()
    },
  },
  {
    // HU-028. The dialog open, which is the state worth looking at: its three
    // sentences are the only warning an administrator gets that the client is
    // about to be emailed.
    stories: 'HU-028 · the warning before a client changes professional',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Cambiar' }).click()
      await expect(page.getByText(/A la persona le llegará un correo/)).toBeVisible()
    },
  },
  {
    // Nobody to move the client to. The gym has one coach, who already has
    // them, so the dialog says that instead of offering an empty list.
    stories: 'HU-028 · there is no other coach to move the client to',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: [activeTeamMember, activeCoach],
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Cambiar' }).click()
      await expect(page.getByText(/No hay otro entrenador activo/)).toBeVisible()
    },
  },
  {
    // HU-029. The dialog open, which is the state worth looking at: its first
    // sentence is the only thing standing between "Proponer" and an
    // administrator believing the client is already covered.
    stories: 'HU-029 · the question put before a cover is proposed',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Proponer suplencia' }).click()
      await expect(page.getByText(/No pasa nada hasta que la persona acepte/)).toBeVisible()
    },
  },
  {
    // Two date fields side by side and an error under them. A field grid that
    // collapses badly, or a message that crowds the footer, shows here and in
    // no other state.
    stories: 'HU-029 · a cover with no end date, refused before the round trip',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    reveal: async (page) => {
      // Tomorrow, in the reader's own timezone, so the start is the one thing
      // the dialog has no objection to and the end date is left alone.
      const pad = (value: number) => `${value}`.padStart(2, '0')
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const startsOn = [
        tomorrow.getFullYear(),
        pad(tomorrow.getMonth() + 1),
        pad(tomorrow.getDate()),
      ].join('-')

      await page.getByRole('button', { name: 'Proponer suplencia' }).click()
      await page.getByRole('combobox', { name: 'Quién cubre' }).click()
      await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
      await page.getByLabel('Desde').fill(startsOn)
      await page.getByRole('button', { name: 'Proponer y preguntar' }).click()
      await expect(page.getByText(/corta el acceso cuando termina/)).toBeVisible()
    },
  },
  {
    /*
     * A cover in the list, which until STUDIO-94 nothing could create, so no
     * sweep had ever drawn one. Beside a badge reading "Esperando respuesta"
     * the dates had ten characters of column left and broke mid-date; the
     * layout sweep is where that belongs, not a pair of eyes.
     */
    stories: 'HU-029 · a cover waiting for an answer, in the list',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState,
      }),
    reveal: async (page) => {
      await expect(page.locator('[data-relationship-substitution-list]')).toContainText(
        'Daniela Hoyos',
      )
    },
  },
  {
    // The holder reading their own client. Since STUDIO-94 the action is
    // offered to them without any capability to assign, and the card has to
    // hold a heading and a button on one line at both widths.
    stories: 'HU-029 · the holder, who may ask for cover on their own client',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [holderMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    reveal: async (page) => {
      await expect(page.getByRole('button', { name: 'Proponer suplencia' })).toBeVisible()
    },
  },
  {
    /*
     * HU-030. A cover that is running, which is the only kind that can be cut
     * short — and the row now carries a third thing beside the name and the
     * badge. Stacked on a phone that is three lines where there were two.
     */
    stories: 'HU-030 · una suplencia corriendo, con la acción de terminarla',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: runningCover(),
      }),
    reveal: async (page) => {
      await expect(page.getByRole('button', { name: 'Terminar', exact: true })).toBeVisible()
    },
  },
  {
    /*
     * The question itself. It is the one dialog in this card that takes an
     * access away rather than asking for one, so it is an `AlertDialog` and its
     * confirm button is destructive — worth looking at beside its siblings.
     */
    stories: 'HU-030 · la pregunta antes de cortar un acceso',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: runningCover(),
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Terminar', exact: true }).click()
      await expect(
        page.getByText(/dejará de ver los datos de esta persona ahora mismo/),
      ).toBeVisible()
    },
  },
  {
    /*
     * HU-031. Un vínculo con historia: una suplencia corriendo y dos
     * terminadas. El servidor las entrega de la más vieja a la más nueva, así
     * que esta pantalla es donde se ve que la accionable encabeza la lista en
     * vez de quedar sepultada — y a la vez, cómo se lee una lista larga en un
     * teléfono.
     */
    stories: 'HU-031 · las suplencias de un cliente con historia',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState: coversWithHistory(),
      }),
    reveal: async (page) => {
      await expect(
        page.locator('[data-relationship-substitution-list] > li').first(),
      ).toContainText('Cubriendo')
    },
  },
  {
    /*
     * HU-032. La acción más pesada de Studio, en su sitio: al final de la
     * ficha, separada del resto, para que nadie la encuentre de camino a otra
     * cosa.
     */
    stories: 'HU-032 · la ficha con la acción de terminar el vínculo',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState,
      }),
    reveal: async (page) => {
      await expect(page.getByRole('button', { name: 'Terminar el vínculo' })).toBeVisible()
    },
  },
  {
    /*
     * El diálogo. Dice tres cosas que nadie adivina, en dos frases, y además
     * lleva un campo. En un teléfono es donde se ve si cabe o si el pie se sale
     * de la pantalla.
     */
    stories: 'HU-032 · la pregunta antes de cerrar la atención a alguien',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organizationMemberships: coachedTeam(),
        relationshipState,
      }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Terminar el vínculo' }).click()
      await expect(page.getByText(/Pasa ahora mismo, sin preaviso/)).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients/[relationshipId]/history` · HU-026 ---
  {
    // The timeline with every kind in it, including the handover whose two
    // halves share an instant. If a date column and a sentence crowd each
    // other, this is where it shows.
    stories: 'HU-026 · what a relationship has been through',
    path: `${workspace}/clients/${relationshipId}/history`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Diana Entrante pasó a atenderla')).toBeVisible()
    },
  },
  {
    // Nothing has happened yet. The empty state has to say what will appear
    // here, because «no hay nada» alone reads as a screen that failed.
    stories: 'HU-026 · a relationship with nothing to tell yet',
    path: `${workspace}/clients/${relationshipId}/history`,
    fixture: () =>
      createStudioApiFixture({ memberships: [activeMembership], relationshipHistory: [] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Todavía no hay nada que contar')).toBeVisible()
    },
  },
  {
    // A coach sees a shorter history and is told so above it, so the notice and
    // the list have to sit together without the warning swamping the content.
    stories: 'HU-026 · the history a coach reads, with the notice that it is partial',
    path: `/organizations/${secondActiveMembership.organization_id}/clients/${relationshipId}/history`,
    fixture: () => createStudioApiFixture({ memberships: [secondActiveMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Ves tu parte de esta historia')).toBeVisible()
    },
  },
  {
    // A coach reads a narrower answer: the policy shows them their own
    // assignment and not the others, so the panel must not claim there are none.
    stories: 'HU-025 · the relationship a coach reads',
    path: `/organizations/${secondActiveMembership.organization_id}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [secondActiveMembership],
        relationshipState: { ...relationshipState, substitutions: [] },
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText(/muestra solo tu propia asignación/)).toBeVisible()
    },
  },
  {
    stories: 'HU-025 · a relationship that is not there, or not ours to read',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: () =>
      createStudioApiFixture({ memberships: [activeMembership], relationshipState: null }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No encontramos este vínculo')).toBeVisible()
    },
  },
  {
    stories: 'HU-025 · the relationship could not be read',
    path: `${workspace}/clients/${relationshipId}`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/relationships\/[^/]+$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar el estado del vínculo')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients/authorizations` · HU-035 ---
  {
    // What every client authorized, across the directory. The widest row is a
    // person's name beside a category name, so this is where a register with
    // five columns has to decide between a table and cards.
    stories: 'HU-035 · what each person authorized us to see',
    path: `${workspace}/clients/authorizations`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Contexto de salud')).toBeVisible()
    },
  },
  {
    // The same register as cards, which is what a phone gets.
    stories: 'HU-035 · what each person authorized, as cards',
    path: `${workspace}/clients/authorizations`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    viewport: MOBILE,
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Contexto de salud')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients/information-categories` · HU-034 ---
  {
    // Seven cards of reference material, each with its own one-line limit. The
    // widest text on the page is a summary, so this is where a card's title and
    // its code badge compete for the same row on a phone.
    stories: 'HU-034 · what each category of information covers',
    path: `${workspace}/clients/information-categories`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Contexto de salud')).toBeVisible()
    },
  },
  {
    // One card open. The client wording is quoted behind a rule, and it is the
    // longest prose the screen ever shows — four lines on a phone.
    stories: 'HU-034 · the wording the client will read',
    path: `${workspace}/clients/information-categories`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page
        .locator('[data-category-card="health_context"]')
        .getByRole('button', { name: 'Ver lo que lee tu cliente' })
        .click()
      await expect(page.getByText('Lo que verá tu cliente')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/clients/invitations/new` · HU-023 ---
  {
    stories: 'HU-023 · inviting somebody, with the permissions to choose from',
    path: `${workspace}/clients/invitations/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Progreso corporal')).toBeVisible()
    },
  },
  {
    // Every box ticked, which is the widest the form ever gets and the state
    // where its descriptions have the least room.
    stories: 'HU-023 · asking for everything on offer',
    path: `${workspace}/clients/invitations/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      // The accessible name is now "Nombre: resumen", so these match on the
      // name rather than equalling it.
      for (const name of [/Entrenamiento con nosotros/, /Progreso corporal/, /Contexto de salud/]) {
        await page.getByRole('checkbox', { name }).click()
      }
      await expect(page.getByRole('checkbox', { name: /Contexto de salud/ })).toBeChecked()
    },
  },
  {
    // What a professional sees when the form refuses to send.
    stories: 'HU-023 · an invitation that asks for nothing',
    path: `${workspace}/clients/invitations/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page.getByLabel('Correo electrónico').fill('ana@example.test')
      await page.getByRole('button', { name: 'Enviar invitación' }).click()
      await expect(page.getByText(/Marca al menos un permiso/)).toBeVisible()
    },
  },
  {
    /*
     * The catalogue is published from Backoffice and is empty everywhere today,
     * production included. Until somebody curates it this is the screen every
     * professional meets, so it is audited rather than left to chance.
     */
    stories: 'HU-023 · no permission has been published yet',
    path: `${workspace}/clients/invitations/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership], offerableScopes: [] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Todavía no hay permisos publicados')).toBeVisible()
    },
  },
  {
    stories: 'HU-023 · the invitation is on its way',
    path: `${workspace}/clients/invitations/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page.getByLabel('Correo electrónico').fill('ana@example.test')
      await page.getByRole('checkbox', { name: /Progreso corporal/ }).click()
      await page.getByRole('button', { name: 'Enviar invitación' }).click()
      await expect(page.getByText('La invitación va en camino')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/organization` · HU-011 ---
  {
    stories: 'HU-011 · the organization and its sites',
    path: `${workspace}/organization`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Allfit Gym SAS')).toBeVisible()
      await expect(page.getByRole('list', { name: 'Sedes de la organización' })).toBeVisible()
    },
  },
  {
    // Label-above-value pairs and the site rows both reflow here: the facts
    // drop from two columns to one, and each site stacks its address.
    stories: 'HU-011 · the organization and its sites on a phone',
    path: `${workspace}/organization`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    viewport: MOBILE,
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByRole('list', { name: 'Sedes de la organización' })).toBeVisible()
    },
  },
  {
    // Two absences at once. Neither is an error, and neither may silently
    // remove its row.
    stories: 'HU-011 · an organization with no legal name and no sites',
    path: `${workspace}/organization`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organization: organizationWithoutSites,
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Sin razón social registrada')).toBeVisible()
      await expect(page.getByText('Aún no hay sedes registradas')).toBeVisible()
    },
  },
  {
    stories: 'HU-011 · the organization could not be read',
    path: `${workspace}/organization`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+$/),
    settled: async (page) => {
      await expect(page.getByText('No pudimos cargar los datos de tu organización')).toBeVisible()
    },
  },
  {
    // Absent, or not ours to read: the API answers both with the same 404 and
    // this screen is what keeps them indistinguishable.
    stories: 'HU-011 · no organization to show',
    path: `${workspace}/organization`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership], organization: null }),
    settled: async (page) => {
      await expect(page.getByText('No encontramos esta organización')).toBeVisible()
    },
  },
  // --- `/organizations/[id]/organization/sites/new` · HU-009 ---
  {
    stories: 'HU-009 · register a site',
    path: `${workspace}/organization/sites/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await expect(page.getByLabel('Nombre')).toBeVisible()
    },
  },
  {
    stories: 'HU-009 · register a site on a phone',
    path: `${workspace}/organization/sites/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    viewport: MOBILE,
    settled: async (page) => {
      await expect(page.getByLabel('Nombre')).toBeVisible()
    },
  },
  {
    // The form refuses in place rather than sending the person somewhere else:
    // a coach arriving by URL learns why, and where the sites are readable.
    stories: 'HU-009 · a role that does not manage sites',
    path: `/organizations/${secondActiveMembership.organization_id}/organization/sites/new`,
    fixture: () => createStudioApiFixture({ memberships: [secondActiveMembership] }),
    settled: async (page) => {
      await expect(page.getByText('Tu rol no administra las sedes')).toBeVisible()
    },
  },
  {
    // The name is required, and the message has to survive on both viewports.
    stories: 'HU-009 · the site needs a name',
    path: `${workspace}/organization/sites/new`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Registrar sede' }).click()
      await expect(page.getByText('Escribe el nombre de la sede.')).toBeVisible()
    },
  },
  {
    /*
     * The longest text the form allows, on the narrowest screen. Every other
     * site fixture is short enough that the row was never going to break, so
     * this is the only screen that puts the edit link under real pressure.
     */
    stories: 'HU-011 · a site whose name and address fill the field',
    path: `${workspace}/organization`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        organization: organizationWithLongSite,
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByRole('link', { name: /^Editar Sede Villavicencio/ })).toBeVisible()
    },
  },
  // --- `/organizations/[id]/organization/sites/[siteId]` · HU-010 ---
  {
    stories: 'HU-010 · edit a site',
    path: `${workspace}/organization/sites/01991600-2000-7000-8000-000000000001`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await expect(page.getByLabel('Nombre')).toHaveValue('Sede Chapinero')
    },
  },
  {
    // The form and the withdrawal panel below it share a column here, so the
    // rule between them carries the whole separation.
    stories: 'HU-010 · edit a site on a phone',
    path: `${workspace}/organization/sites/01991600-2000-7000-8000-000000000001`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    viewport: MOBILE,
    settled: async (page) => {
      await expect(page.getByLabel('Nombre')).toHaveValue('Sede Chapinero')
    },
  },
  {
    // The confirmation carries criterion 1 of the story: what withdrawing does
    // not touch, said to the person about to do it.
    stories: 'HU-010 · confirming a site withdrawal',
    path: `${workspace}/organization/sites/01991600-2000-7000-8000-000000000001`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Retirar de servicio', exact: true }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
    },
  },
  {
    // A withdrawn site offers the opposite action, and says what it restores.
    stories: 'HU-010 · putting a withdrawn site back in service',
    path: `${workspace}/organization/sites/01991600-2000-7000-8000-000000000003`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await expect(page.getByRole('button', { name: 'Poner en servicio' })).toBeVisible()
    },
  },
  {
    // A site that is not in this organization, whether it never existed or
    // belongs to another: the screen cannot tell, and neither may the reader.
    stories: 'HU-010 · the site is not there',
    path: `${workspace}/organization/sites/01991600-2000-7000-8000-000000000999`,
    fixture: () => createStudioApiFixture({ memberships: [activeMembership] }),
    settled: async (page) => {
      await expect(page.getByText('No encontramos esta sede')).toBeVisible()
    },
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
      await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
    },
  },
  {
    stories: 'HU-006 · the memberships you hold',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Vinculaciones' }).click()
      await expect(page.getByText('Vinculaciones activas')).toBeVisible()
    },
  },
  {
    // Not a failed load: the account is on screen and stays there. Retiring a
    // credential is what asks for the account again, so that is the read that
    // fails here — the person acted, and the answer never arrived.
    stories: 'HU-005 · the account could not be refreshed',
    path: '/account',
    fixture: () => {
      // Tied to the retirement rather than to a request count: the screen reads
      // the account more than once while it mounts, and failing the second read
      // would break the load instead of the refresh that follows the command.
      let retired = false
      return createStudioApiFixture({
        me: {
          profile: { ...professionalProfile, credentials: [professionalCredential] },
          memberships: [activeMembership],
        },
        memberships: [activeMembership],
        intercept: (request) => {
          if (request.method === 'POST' && request.path.endsWith('/retirement')) {
            retired = true
            return undefined
          }
          return retired && request.method === 'GET' && request.path === '/studio/v1/me'
            ? { status: 503, body: error('upstream-unavailable') }
            : undefined
        },
      })
    },
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
      await page.getByRole('button', { name: 'Retirar' }).click()
      await page.getByRole('button', { name: 'Retirar credencial' }).click()
      await expect(page.getByText('No pudimos actualizar tu cuenta')).toBeVisible()
    },
  },
  {
    // The only failure the product shows inside a dialog: the draft stays, so
    // the person does not lose what they typed.
    stories: 'HU-005 · the credential revision could not be saved',
    path: '/account',
    fixture: () =>
      createStudioApiFixture({
        me: {
          profile: { ...professionalProfile, credentials: [professionalCredential] },
          memberships: [activeMembership],
        },
        memberships: [activeMembership],
        intercept: (request) =>
          request.method === 'POST' && request.path.endsWith('/revisions')
            ? { status: 503, body: error('upstream-unavailable') }
            : undefined,
      }),
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
      await page.getByRole('button', { name: 'Crear revisión' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Crear revisión' }).click()
      await expect(dialog.getByText('No pudimos guardar')).toBeVisible()
    },
  },
  {
    // Retiring is the one credential action that cannot be undone from the
    // screen, so it asks first. The dialog is also where issue #42's question
    // about `AlertDialogHeader` spacing becomes answerable.
    stories: 'HU-005 · confirming a credential retirement',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
      await page.getByRole('button', { name: 'Retirar' }).click()
      await expect(page.getByText('¿Retirar esta credencial?')).toBeVisible()
    },
  },
  {
    stories: 'HU-005 · no credentials declared yet',
    path: '/account',
    fixture: withProfileAndNoCredentials,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
      await expect(page.getByText('Aún no has declarado credenciales')).toBeVisible()
    },
  },
  {
    stories: 'HU-006 · no memberships left',
    path: '/account',
    fixture: withoutActiveSpaces,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Vinculaciones' }).click()
      await expect(page.getByText('Aún no tienes vinculaciones')).toBeVisible()
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
  // The two waits on this route. Neither was in the inventory, so neither had
  // been swept or looked at, and production showed them as a bare spinner and a
  // paragraph against the left edge.
  {
    stories: 'HU-005 · opening the account',
    path: '/account',
    fixture: stall('/studio/v1/me'),
    hasHeading: false,
    settled: async (page) => {
      await expect(page.getByText('Reuniendo tus espacios y opciones personales…')).toBeVisible()
    },
  },
  {
    stories: 'HU-005 · gathering the professional catalogues',
    path: '/account',
    fixture: () =>
      createStudioApiFixture({
        me: { profile: null, memberships: [activeMembership] },
        memberships: [activeMembership],
        intercept: async (request) => {
          if (request.path === '/studio/v1/professional-specialties') {
            await new Promise((resolve) => setTimeout(resolve, 15_000))
          }
          return undefined
        },
      }),
    hasHeading: false,
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Configurar perfil profesional' }).click()
      await expect(page.getByText('Reuniendo especialidades y tipos de credencial…')).toBeVisible()
      // One status at a time: the refresh line fired during the first load too.
      await expect(page.getByText('Actualizando tu cuenta…')).toBeHidden()
    },
  },

  // --- the team section -------------------------------------------------------
  { stories: 'HU-017 · team directory', path: `${workspace}/team`, fixture: memberOfTwo },
  {
    // HU-019. The dialog open, which is the state worth looking at: the
    // sentence under the picker is the only place that says a role gives
    // access to nobody's data.
    stories: 'HU-019 · the warning before giving somebody a role',
    path: `${workspace}/team`,
    fixture: memberOfTwo,
    reveal: async (page) => {
      await page
        .getByRole('button', { name: /Añadir un rol/ })
        .first()
        .click()
      await expect(page.getByText(/Un rol no da acceso a los datos de nadie/)).toBeVisible()
    },
  },
  {
    // A register renders a card list instead of its table when its own
    // container has no room for one, which a phone never does. The two are
    // separate markup rather than one behind a CSS toggle.
    stories: 'HU-017 · team directory as cards',
    path: `${workspace}/team`,
    fixture: memberOfTwo,
    viewport: MOBILE,
  },
  {
    // A coach keeps the section and is told why it is shut, rather than losing
    // the link and finding the same label lead somewhere else.
    stories: 'HU-017 · team directory a coach may not read',
    path: `/organizations/${secondActiveMembership.organization_id}/team`,
    fixture: asCoach,
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No tienes acceso a este directorio')).toBeVisible()
    },
  },
  {
    // Reached by opening either invitation URL: `/new` redirects here, because
    // there is no form to show a role that cannot propose one.
    stories: 'HU-015 · invitations a coach may not read',
    path: `/organizations/${secondActiveMembership.organization_id}/team/invitations`,
    fixture: asCoach,
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No puedes consultar las invitaciones')).toBeVisible()
    },
  },
  {
    stories: 'HU-017 · the team directory while it loads',
    path: `${workspace}/team`,
    fixture: stallingFor([activeMembership], /\/organizations\/[^/]+\/memberships$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Cargando integrantes')).toBeVisible()
    },
  },
  {
    stories: 'HU-015 · the invitation register while it loads',
    path: `${workspace}/team/invitations`,
    fixture: stallingFor([activeMembership], /\/organizations\/[^/]+\/invitations$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('Cargando invitaciones')).toBeVisible()
    },
  },
  {
    stories: 'HU-017 · the team directory could not be read',
    path: `${workspace}/team`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/memberships$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar el equipo')).toBeVisible()
    },
  },
  { stories: 'HU-018 · role catalog', path: `${workspace}/team/roles`, fixture: memberOfTwo },
  {
    stories: 'HU-018 · the role catalog could not be read',
    path: `${workspace}/team/roles`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/roles$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar los roles')).toBeVisible()
    },
  },
  {
    stories: 'HU-016 · confirming an invitation revocation',
    path: `${workspace}/team/invitations`,
    fixture: withIssuedInvitations,
    reveal: async (page) => {
      await page.getByRole('button', { name: 'Revocar' }).first().click()
      await expect(page.getByText('¿Revocar esta invitación?')).toBeVisible()
    },
  },
  {
    stories: 'HU-015 · the invitation register could not be read',
    path: `${workspace}/team/invitations`,
    fixture: failingFor([activeMembership], /\/organizations\/[^/]+\/invitations$/),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No pudimos cargar las invitaciones')).toBeVisible()
    },
  },
  {
    stories: 'HU-018 · the role catalog was refused',
    path: `${workspace}/team/roles`,
    fixture: () =>
      createStudioApiFixture({
        memberships: [activeMembership],
        intercept: (request) =>
          request.path.endsWith('/roles') ? { status: 403, body: error('forbidden') } : undefined,
      }),
    settled: async (page) => {
      await settledByHeading(page)
      await expect(page.getByText('No puedes consultar estos roles')).toBeVisible()
    },
  },
  {
    stories: 'HU-015 / HU-016 · issued invitations',
    path: `${workspace}/team/invitations`,
    fixture: withIssuedInvitations,
  },
  {
    // Six columns never fit a phone, so the register renders as cards —
    // separate markup, like the directory's, not one behind a toggle.
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
