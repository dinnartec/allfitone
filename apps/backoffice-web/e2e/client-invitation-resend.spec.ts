import { expect, test } from '@playwright/test'

import {
  activeSession,
  clientInvitationRecord,
  createBackofficeFixture,
  mockBackofficeApi,
  organizationFileRecord,
} from './backoffice-api-mock'

function operatingGym() {
  return organizationFileRecord()
}

test('support sees what each client invitation asked for before resending it', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const live = clientInvitationRecord({
    contact_hint: 'l***@example.test',
    state: 'pending',
    scope_codes: ['body_progress', 'relationship_training'],
  })
  const accepted = clientInvitationRecord({
    contact_hint: 'j***@example.test',
    state: 'accepted',
    resendable: false,
  })
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [gym] },
    clientInvitations: { lists: { [gym.organization.organization_id]: [live, accepted] } },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${gym.organization.organization_id}`)

  const section = page.locator('[data-client-invitations]')
  await expect(section.getByRole('heading', { name: 'Invitaciones de cliente' })).toBeVisible()
  await expect(section.locator('[data-client-invitation]')).toHaveCount(2)
  // The offer is named, not shown as codes.
  await expect(
    section.locator(
      '[data-client-invitation][data-state="pending"] [data-client-invitation-offer]',
    ),
  ).toContainText('Progreso corporal')
  await expect(
    section
      .locator('[data-client-invitation][data-state="accepted"]')
      .getByText('Ya fue aceptada.'),
  ).toBeVisible()
  await expect(
    section.getByRole('button', {
      name: 'Reenviar la invitación de cliente a j***@example.test',
    }),
  ).toHaveCount(0)

  await section
    .getByRole('button', { name: 'Reenviar la invitación de cliente a l***@example.test' })
    .click()

  await expect(section.locator('[data-client-invitation-outcome]')).toContainText(
    'El primer correo sigue sirviendo',
  )
  const resends = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.includes('/client-invitations/'),
  )
  expect(resends).toHaveLength(1)
  expect(resends[0]?.path).toBe(
    `/backoffice/v1/organizations/${gym.organization.organization_id}/client-invitations/${live.invitation_id}/resends`,
  )
  // The command carries nothing: the gym, the contact and the offer come from the invitation.
  expect(resends[0]?.body).toEqual({})
  expect(resends[0]?.headers['idempotency-key']).toBeTruthy()
})

test('an expired invitation is replaced by one Allfit signs that asks for exactly the same', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const expired = clientInvitationRecord({
    contact_hint: 'e***@example.test',
    state: 'expired',
    scope_codes: ['health_context', 'relationship_training'],
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      clientInvitations: { lists: { [gym.organization.organization_id]: [expired] } },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  const section = page.locator('[data-client-invitations]')
  await section
    .getByRole('button', { name: 'Reenviar la invitación de cliente a e***@example.test' })
    .click()

  await expect(section.locator('[data-client-invitation-outcome]')).toContainText(
    'los mismos permisos',
  )
  await expect(section.locator('[data-client-invitation]')).toHaveCount(2)
  const renewed = section.locator('[data-client-invitation][data-state="pending"]')
  await expect(renewed.getByText('Allfit, al reenviar una vencida')).toBeVisible()
  await expect(renewed.locator('[data-client-invitation-offer]')).toContainText('Contexto de salud')
  await expect(
    section.locator(
      '[data-client-invitation][data-state="expired"] [data-client-invitation-reason]',
    ),
  ).toContainText('Ya se reemplazó por otra')
})

test('a resend lost to the network is retried with the same command, so nobody gets two emails', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const live = clientInvitationRecord({ contact_hint: 'l***@example.test' })
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [gym] },
    clientInvitations: { lostResends: 1, lists: { [gym.organization.organization_id]: [live] } },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  const section = page.locator('[data-client-invitations]')
  const resend = section.getByRole('button', {
    name: 'Reenviar la invitación de cliente a l***@example.test',
  })

  await resend.click()
  await expect(section.locator('[data-client-invitation-failure]')).toContainText(
    'No hay conexión con el API.',
  )
  await resend.click()
  await expect(section.locator('[data-client-invitation-outcome]')).toContainText(
    'El primer correo sigue sirviendo',
  )

  const attempts = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.includes('/client-invitations/'),
  )
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['idempotency-key']).toBe(attempts[0]?.headers['idempotency-key'])
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
})

test('a reissue whose offer would not match is refused as a conflict, not as a mistake', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      clientInvitations: {
        resendRefusal: { status: 409, code: 'conflict' },
        lists: { [gym.organization.organization_id]: [clientInvitationRecord()] },
      },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  await page
    .getByRole('button', { name: 'Reenviar la invitación de cliente a c***@example.test' })
    .click()

  await expect(page.locator('[data-client-invitation-failure]')).toContainText('no coincide')
})

test('without the support duty the section says which duty it needs', async ({ context, page }) => {
  const gym = operatingGym()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      clientInvitations: { refusal: { status: 403, code: 'forbidden' }, lists: {} },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)

  await expect(page.locator('[data-client-invitations]')).toContainText('deber de soporte')
  // The refusal is the section's alone: the rest of the file still opens.
  await expect(page.getByRole('heading', { name: gym.organization.display_name })).toBeVisible()
})

test('a gym nobody claimed has no client invitations to resend', async ({ context, page }) => {
  const base = organizationFileRecord()
  const unclaimed = organizationFileRecord({
    organization: { ...base.organization, status: 'unclaimed', claimed_at: null },
    owner: null,
    team: [],
    team_counts: { active: 0, terminated: 0 },
  })
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [unclaimed] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${unclaimed.organization.organization_id}`)

  await expect(page.locator('[data-client-invitations]')).toHaveCount(0)
  expect(fixture.requests.some((request) => request.path.endsWith('/client-invitations'))).toBe(
    false,
  )
})

test('a gym that has invited nobody says so instead of showing an empty table', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      clientInvitations: { lists: { [gym.organization.organization_id]: [] } },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)

  await expect(page.locator('[data-client-invitations-empty]')).toContainText(
    'no ha invitado a nadie como cliente',
  )
})
