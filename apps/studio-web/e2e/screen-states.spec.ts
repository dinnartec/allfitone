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
  await page.getByRole('tab', { name: 'Credenciales opcionales' }).click()

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
