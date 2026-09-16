import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  type MockRequest,
  type MockResponse,
} from './studio-api-mock'

const TOKEN = 'B'.repeat(43)
const INVITATION_ID = '01991700-7000-7000-8000-000000000001'
const INTENT_ID = '01991700-7000-7000-8000-000000000002'

const presentation = {
  id: INVITATION_ID,
  organization: {
    id: activeMembership.organization_id,
    display_name: 'Handover Norte',
    type_name: 'Gimnasio',
    party_kind: 'legal_entity',
    legal_name: 'Norte Fitness SAS',
    site_name: 'Sede Principal',
  },
  expires_at: '2030-09-20T12:00:00.000Z',
  intent: { id: INTENT_ID, status: 'pending' },
}

function ownershipIntercept(
  request: MockRequest,
  options: {
    decision?: 'accepted' | 'rejected'
    presentation?: typeof presentation
    decisionRefusal?: MockResponse
  } = {},
): MockResponse | undefined {
  if (request.method === 'POST' && request.path === '/studio/v1/invitations/resolve') {
    return { status: 404, body: error('not-found') }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/ownership-invitations/resolve') {
    return { status: 200, body: options.presentation ?? presentation }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/ownership-invitations/decisions') {
    if (options.decisionRefusal) return options.decisionRefusal
    const decision = options.decision ?? 'accepted'
    return {
      status: 200,
      body: {
        invitation_id: INVITATION_ID,
        invitation_status: 'completed',
        organization_id: activeMembership.organization_id,
        intent: {
          id: INTENT_ID,
          status: decision,
          membership_id: decision === 'accepted' ? activeMembership.membership_id : null,
        },
        replayed: false,
      },
    }
  }
  return undefined
}

test('an organization Allfit hands over opens on the same invitation page', async ({ page }) => {
  const fixture = createStudioApiFixture({ intercept: (request) => ownershipIntercept(request) })
  await installStudioApiMock(page, fixture)

  await page.goto(`/invitations#token=${TOKEN}`)

  // The organization is the heading on its own now: inside the sentence the
  // title ran five lines on a desktop and four on a phone, so the verb moved to
  // the description, where this still asserts it.
  await expect(page.getByRole('heading', { name: 'Handover Norte' })).toBeVisible()
  await expect(page.getByText(/está lista para que la recibas/)).toBeVisible()
  await expect(page.getByText(/existe pero no opera/)).toBeVisible()
  await expect(page.getByText('Norte Fitness SAS')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  const resolutions = fixture.requests
    .filter((request) => request.path.endsWith('/resolve'))
    .map((request) => request.path)
  expect(resolutions).toEqual([
    '/studio/v1/invitations/resolve',
    '/studio/v1/ownership-invitations/resolve',
  ])
  expect(
    fixture.requests.find((request) => request.path === '/studio/v1/ownership-invitations/resolve')
      ?.body,
  ).toEqual({ token: TOKEN })
})

test('accepting sends the ownership decision with command identity and enters the organization', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => ownershipIntercept(request),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Aceptar y recibir la organización' }).click()

  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)
  expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain(TOKEN)
  const decision = fixture.requests.find(
    (request) => request.path === '/studio/v1/ownership-invitations/decisions',
  )
  expect(decision?.body).toEqual({ token: TOKEN, intent_id: INTENT_ID, decision: 'accepted' })
  expect(decision?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(decision?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
  expect(
    fixture.requests.filter((request) => request.path === '/studio/v1/invitations/decisions'),
  ).toHaveLength(0)
})

test('rejecting says the organization stays without an owner', async ({ page }) => {
  const fixture = createStudioApiFixture({
    intercept: (request) => ownershipIntercept(request, { decision: 'rejected' }),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Rechazar', exact: true }).click()

  await expect(page.getByText('Rechazaste la invitación')).toBeVisible()
  await expect(page.getByText(/No quedaste como propietario de Handover Norte/)).toBeVisible()
})

test('a natural person is told their own account names them', async ({ page }) => {
  const fixture = createStudioApiFixture({
    intercept: (request) =>
      ownershipIntercept(request, {
        presentation: {
          ...presentation,
          organization: {
            ...presentation.organization,
            party_kind: 'natural_person',
            legal_name: null,
          },
        } as unknown as typeof presentation,
      }),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await expect(page.getByText('Tú, con el nombre de tu cuenta')).toBeVisible()
})

test('a token that is neither kind of invitation is simply unavailable', async ({ page }) => {
  const fixture = createStudioApiFixture({
    intercept: (request) => {
      if (request.path.endsWith('/resolve')) return { status: 404, body: error('not-found') }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await expect(page.getByText('Esta invitación ya no está disponible')).toBeVisible()
})

test('the wrong account is asked to switch without revealing the invited address', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    intercept: (request) =>
      ownershipIntercept(request, {
        decisionRefusal: { status: 403, body: error('forbidden') },
      }),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Aceptar y recibir la organización' }).click()

  await expect(page.getByText('Esta invitación fue enviada a otra cuenta')).toBeVisible()
  await expect(page.getByText(/@/)).toHaveCount(0)
})
