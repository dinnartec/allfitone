/**
 * Conflict handling for the Studio commands that recover from a 409.
 *
 * `professional-credentials.tsx`, `team-invitation-list.tsx` and
 * `activation-form.tsx` all branch on a 409 and promise a specific recovery:
 * reset the command intent, refresh the stale data, and tell the person what
 * happened. Nothing exercised that branch, so the promise was untested while the
 * 503 path next to it had several tests. These cover the two read-and-command
 * screens named in the AFO-40 audit brief.
 *
 * The expected copy is taken from the components, not invented, so a reworded
 * message fails here and is reviewed rather than silently dropped.
 */
import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  professionalCredential,
  professionalProfile,
} from './studio-api-mock'

const INVITATION_ID = '01991600-7000-7000-8000-000000000101'
const INTENT_ID = '01991600-7000-7000-8000-000000000102'
const CONTACT = 'ya-decidida@example.test'

const pendingInvitation = {
  id: INVITATION_ID,
  status: 'pending',
  channel: 'email',
  contact: CONTACT,
  created_at: '2026-08-11T12:00:00.000Z',
  expires_at: '2030-08-18T12:00:00.000Z',
  intents: [
    {
      id: INTENT_ID,
      kind: 'membership',
      status: 'pending',
      proposed_role_code: 'staff',
      decided_at: null,
    },
  ],
}

test('a revocation that lost the race explains the invitation was already decided', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (
        request.method === 'GET' &&
        request.path === `/studio/v1/organizations/${activeMembership.organization_id}/invitations`
      ) {
        return { status: 200, body: { data: [pendingInvitation], page: { next_cursor: null } } }
      }
      // Someone else decided this invitation between the read and the command.
      if (request.method === 'POST' && request.path.endsWith('/revocation')) {
        return { status: 409, body: error('already-decided') }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team/invitations`)

  await page
    .getByRole('row')
    .filter({ hasText: CONTACT })
    .getByRole('button', { name: 'Revocar' })
    .click()

  const dialog = page.getByRole('alertdialog', { name: '¿Revocar esta invitación?' })
  await dialog.getByRole('button', { name: 'Revocar invitación' }).click()

  await expect(
    page.getByText('La invitación ya fue decidida. Cierra este diálogo y actualiza la lista.'),
  ).toBeVisible()

  // The generic failure copy must not appear: a conflict is not a retryable error.
  await expect(page.getByText('No pudimos revocar la invitación.')).toHaveCount(0)
})

const membershipsPath = `/studio/v1/organizations/${activeMembership.organization_id}/memberships`
const invitationsPath = `/studio/v1/organizations/${activeMembership.organization_id}/invitations`
const emptyPage = { status: 200, body: { data: [], page: { next_cursor: null } } } as const

/**
 * Empty is not the same as fabricated. Each of these loads a screen against an
 * API that returns nothing and asserts the screen says so, with no rows behind
 * it — which is also how the audit closes the "no plausible data left in a
 * production journey" item: hardcoded content would survive an empty API.
 */
test('an empty invitation register says so instead of showing rows', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) =>
      request.method === 'GET' && request.path === invitationsPath ? emptyPage : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team/invitations`)

  await expect(page.getByText('Todavía no hay invitaciones emitidas')).toBeVisible()
  // The empty notice occupies a row of its own, so counting rows proves little.
  // What matters is that no invitation is on screen: every real row carries a
  // contact and a Revocar action.
  await expect(page.getByRole('table')).not.toContainText('@')
  await expect(page.getByRole('button', { name: 'Revocar' })).toHaveCount(0)
  expect(fixture.requests.some((request) => request.path === invitationsPath)).toBe(true)
})

test('an organization with no team yet says so instead of inventing members', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) =>
      request.method === 'GET' &&
      (request.path === membershipsPath || request.path === invitationsPath)
        ? emptyPage
        : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByText('Trabajas en solitario por ahora')).toBeVisible()
  await expect(page.getByText('Cuando alguien acepte una invitación aparecerá aquí.')).toBeVisible()
  await expect(page.locator('[data-overview-team-list] li')).toHaveCount(0)
  await expect(page.locator('[data-overview-attention-list] li')).toHaveCount(0)
})

/**
 * The loading state is held open deliberately rather than raced against a
 * timeout: the response is released only after the assertion, so the test
 * cannot pass because the machine was slow or fail because it was fast.
 */
test('the team directory announces that it is loading before any row exists', async ({ page }) => {
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: async (request) => {
      if (request.method === 'GET' && request.path === membershipsPath) await held
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await expect(page.getByText('Cargando integrantes')).toBeVisible()
  await expect(
    page.getByText('Estamos comprobando las membresías de esta organización.'),
  ).toBeVisible()

  release?.()
  await expect(page.getByText('Cargando integrantes')).toHaveCount(0)
})

/**
 * The OpenAPI contract declares 403 as a response of
 * `GET /studio/v1/me/memberships`, and every screen-level list already tells a
 * permission denial apart from a transient failure. The organization
 * verification layer did not: it reported "the connection failed temporarily"
 * and offered a retry the query layer refuses to perform for a 403.
 */
test('a forbidden membership check offers another space instead of a futile retry', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [],
    intercept: (request) =>
      request.method === 'GET' && request.path === '/studio/v1/me/memberships'
        ? { status: 403, body: error('forbidden') }
        : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByText('Este espacio no está disponible')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Elegir otro espacio' })).toBeVisible()

  // A denial is not a connection problem, and retrying it never succeeds:
  // shouldRetryStudioQuery returns false for 403.
  await expect(page.getByText('La conexión falló de forma temporal')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('retiring a credential that already changed refreshes the profile instead of failing', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [professionalCredential] },
      memberships: [activeMembership],
    },
    memberships: [activeMembership],
    intercept: (request) =>
      request.method === 'POST' &&
      request.path.startsWith('/studio/v1/me/professional-credentials/') &&
      request.path.endsWith('/retirement')
        ? { status: 409, body: error('already-changed') }
        : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/account')
  await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()

  await page.getByRole('button', { name: 'Retirar' }).click()
  const dialog = page.getByRole('alertdialog', { name: '¿Retirar esta credencial?' })
  await dialog.getByRole('button', { name: 'Retirar credencial' }).click()

  await expect(
    page.getByText('La credencial había cambiado. Actualizamos tu perfil.'),
  ).toBeVisible()
  await expect(page.getByText('No pudimos retirar la credencial.')).toHaveCount(0)

  // The recovery is a refresh, not a silent swallow: the profile is re-read.
  const rereads = fixture.requests.filter(
    (request) => request.method === 'GET' && request.path === '/studio/v1/me',
  )
  expect(rereads.length).toBeGreaterThan(1)
})
