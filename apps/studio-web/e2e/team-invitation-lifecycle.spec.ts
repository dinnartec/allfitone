import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  type MockRequest,
  type MockResponse,
} from './studio-api-mock'

const TOKEN = 'A'.repeat(43)
const INVITATION_ID = '01991600-7000-7000-8000-000000000001'
const INTENT_ID = '01991600-7000-7000-8000-000000000002'

const presentation = {
  id: INVITATION_ID,
  status: 'pending',
  organization: {
    id: activeMembership.organization_id,
    display_name: activeMembership.display_name,
    responsible_party: { kind: 'natural_person', name: 'Ada Owner' },
  },
  expires_at: '2030-08-18T12:00:00.000Z',
  intents: [
    {
      id: INTENT_ID,
      kind: 'membership',
      status: 'pending',
      proposed_role_code: 'staff',
    },
  ],
}

function invitationIntercept(
  request: MockRequest,
  decision: 'accepted' | 'rejected' = 'accepted',
): MockResponse | undefined {
  if (request.method === 'POST' && request.path === '/studio/v1/invitations/resolve') {
    return { status: 200, body: presentation }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/invitations/decisions') {
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
}

test('removes the fragment before rendering and keeps the token only in the tab', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    intercept: (request) => invitationIntercept(request),
  })
  await installStudioApiMock(page, fixture)

  await page.goto(`/invitations#token=${TOKEN}`)

  await expect(
    page.getByRole('heading', {
      name: `${activeMembership.display_name} quiere sumarte a su equipo.`,
    }),
  ).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  expect(await page.evaluate(() => Object.values(sessionStorage))).toContain(TOKEN)
  const resolve = fixture.requests.find(
    (request) => request.path === '/studio/v1/invitations/resolve',
  )
  expect(resolve?.body).toEqual({ token: TOKEN })
  expect(fixture.requests.every((request) => !request.path.includes(TOKEN))).toBe(true)
})

test('accepts with command identity, clears the token and enters the organization', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => invitationIntercept(request),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Aceptar invitación' }).click()

  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)
  expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain(TOKEN)
  const decision = fixture.requests.find(
    (request) => request.path === '/studio/v1/invitations/decisions',
  )
  expect(decision?.body).toEqual({
    token: TOKEN,
    decisions: [{ intent_id: INTENT_ID, decision: 'accepted' }],
  })
  expect(decision?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(decision?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('rejects without creating a membership and clears the terminal token', async ({ page }) => {
  const fixture = createStudioApiFixture({
    intercept: (request) => invitationIntercept(request, 'rejected'),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Rechazar', exact: true }).click()

  await expect(page.getByText('Rechazaste la invitación')).toBeVisible()
  await expect(page.getByText(/No se creó ninguna membresía/)).toBeVisible()
  expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain(TOKEN)
})

test('keeps the token for account switching without revealing the invited email', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    intercept: (request) => {
      if (request.path === '/studio/v1/invitations/decisions') {
        return { status: 403, body: error('forbidden') }
      }
      return invitationIntercept(request)
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await page.getByRole('button', { name: 'Aceptar invitación' }).click()

  await expect(page.getByText('Esta invitación fue enviada a otra cuenta')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  await expect(page.getByText(/@/)).toHaveCount(0)
  expect(await page.evaluate(() => Object.values(sessionStorage))).toContain(TOKEN)
})

test('associates the token during personal activation without accepting it', async ({ page }) => {
  const fixture = createStudioApiFixture({
    session: {
      authenticated: true,
      registration_status: 'registration_incomplete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    },
    intercept: (request) => {
      if (request.method === 'POST' && request.path === '/studio/v1/onboarding-attempts') {
        return {
          status: 200,
          body: {
            id: '01991600-4000-7000-8000-000000000001',
            status: 'open',
            eligibility_status: 'pending',
            expires_at: '2030-08-18T12:00:00.000Z',
            terms_version: 'platform_terms_v1',
            privacy_notice_version: 'privacy_notice_v1',
          },
        }
      }
      return invitationIntercept(request)
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/invitations#token=${TOKEN}`)

  await expect(
    page.getByRole('heading', { name: 'Confirma y deja tu identidad lista.' }),
  ).toBeVisible()
  const attempt = fixture.requests.find(
    (request) => request.path === '/studio/v1/onboarding-attempts',
  )
  expect(attempt?.body).toEqual({ invitation_token: TOKEN })
  expect(
    fixture.requests.filter((request) => request.path === '/studio/v1/invitations/decisions'),
  ).toHaveLength(0)
  expect(await page.evaluate(() => Object.values(sessionStorage))).toContain(TOKEN)
})

test('lists, filters, paginates and revokes a pending team invitation', async ({ page }) => {
  const firstItem = {
    id: INVITATION_ID,
    status: 'pending',
    channel: 'email',
    contact: 'person@example.test',
    created_at: '2026-08-11T12:00:00.000Z',
    expires_at: '2030-08-18T12:00:00.000Z',
    intents: presentation.intents.map((intent) => ({ ...intent, decided_at: null })),
  }
  const secondItem = {
    ...firstItem,
    id: '01991600-7000-7000-8000-000000000003',
    contact: 'second@example.test',
  }
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (
        request.method === 'GET' &&
        request.path === `/studio/v1/organizations/${activeMembership.organization_id}/invitations`
      ) {
        if (request.search.includes('cursor=')) {
          return { status: 200, body: { data: [secondItem], page: { next_cursor: null } } }
        }
        return {
          status: 200,
          body: { data: [firstItem], page: { next_cursor: 'next-page' } },
        }
      }
      if (request.method === 'POST' && request.path.endsWith('/revocation')) {
        return { status: 200, body: { id: INVITATION_ID, status: 'revoked' } }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team/invitations`)

  await expect(page.getByRole('table')).toContainText('person@example.test')
  await page.getByRole('button', { name: 'Ver más' }).click()
  await expect(page.getByRole('table')).toContainText('second@example.test')

  await page.getByRole('button', { name: 'Pendientes' }).click()
  await expect
    .poll(() => fixture.requests.some((request) => request.search.includes('status=pending')))
    .toBe(true)

  page.once('dialog', (dialog) => void dialog.accept())
  await page
    .getByRole('row')
    .filter({ hasText: 'person@example.test' })
    .getByRole('button', { name: 'Revocar' })
    .click()
  await expect(page.getByRole('table')).toContainText('Revocada')
  const revocation = fixture.requests.find((request) => request.path.endsWith('/revocation'))
  expect(revocation?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(revocation?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})
