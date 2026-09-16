/**
 * Every stage that replaces the page announces itself with a page heading.
 *
 * These stages are built from an Alert, and `AlertTitle` renders a plain div, so
 * each of them used to reach the browser with no heading at any level: someone
 * navigating by headings landed on a full-screen message the document outline
 * did not contain. The WCAG sweep in accessibility.spec.ts cannot catch this —
 * axe files `page-has-heading-one` under best-practice rather than wcag2a/aa —
 * which is why they stayed invisible while that suite was green.
 *
 * The fix follows the idiom this codebase already uses in eight places for
 * CardTitle: `role="heading"` with an explicit level. Level 1, because these
 * stages are the page rather than a section inside one.
 */
import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
} from './studio-api-mock'

interface Stage {
  name: string
  heading: string
  path: string
  open: (page: Page) => Promise<void>
}

const workspace = `/organizations/${activeMembership.organization_id}`

const STAGES: Stage[] = [
  {
    name: 'the entry flow cannot reach the identity service',
    heading: 'No pudimos abrir Studio',
    path: '/',
    open: async (page) => {
      await installStudioApiMock(
        page,
        createStudioApiFixture({
          intercept: (request) =>
            request.path === '/studio/v1/entry-context'
              ? { status: 503, body: error('upstream-unavailable') }
              : undefined,
        }),
      )
    },
  },
  {
    name: 'the membership behind an organization was revoked',
    heading: 'Este espacio no está disponible',
    path: workspace,
    open: async (page) => {
      await installStudioApiMock(
        page,
        createStudioApiFixture({
          memberships: [],
          intercept: (request) =>
            request.path === '/studio/v1/me/memberships'
              ? { status: 403, body: error('forbidden') }
              : undefined,
        }),
      )
    },
  },
  {
    name: 'the membership check itself failed',
    heading: 'No pudimos comprobar tu acceso',
    path: workspace,
    open: async (page) => {
      await installStudioApiMock(
        page,
        createStudioApiFixture({
          memberships: [],
          intercept: (request) =>
            request.path === '/studio/v1/me/memberships'
              ? { status: 500, body: error('boom') }
              : undefined,
        }),
      )
    },
  },
  {
    name: 'the account could not be opened',
    heading: 'No pudimos abrir tu cuenta',
    path: '/account',
    open: async (page) => {
      await installStudioApiMock(
        page,
        createStudioApiFixture({
          memberships: [activeMembership],
          intercept: (request) =>
            request.method === 'GET' && request.path === '/studio/v1/me'
              ? { status: 500, body: error('boom') }
              : undefined,
        }),
      )
    },
  },
  {
    // invalid, mismatch, rejected and error all render through one
    // InvitationMessage component, so covering one covers the renderer.
    name: 'an invitation is no longer available',
    heading: 'Esta invitación ya no está disponible',
    path: '/invitations',
    open: async (page) => {
      await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
    },
  },
]

for (const stage of STAGES) {
  test(`announces a page heading when ${stage.name}`, async ({ page }) => {
    await stage.open(page)
    await page.goto(stage.path)

    const heading = page.getByRole('heading', { level: 1, name: stage.heading })
    await expect(heading).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })
}
