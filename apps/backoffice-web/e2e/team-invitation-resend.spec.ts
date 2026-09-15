import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  organizationFileRecord,
  teamInvitationRecord,
} from './backoffice-api-mock'

function operatingGym() {
  return organizationFileRecord()
}

test('support resends a live invitation as it is, and the first email keeps working', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const live = teamInvitationRecord({ contact_hint: 'l***@example.test', state: 'pending' })
  const accepted = teamInvitationRecord({
    contact_hint: 'j***@example.test',
    state: 'accepted',
    resendable: false,
  })
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [gym] },
    teamInvitations: { lists: { [gym.organization.organization_id]: [live, accepted] } },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${gym.organization.organization_id}`)

  const section = page.locator('[data-team-invitations]')
  await expect(section.getByRole('heading', { name: 'Invitaciones de equipo' })).toBeVisible()
  await expect(section.locator('[data-team-invitation]')).toHaveCount(2)
  await expect(
    section.locator('[data-team-invitation][data-state="accepted"]').getByText('Ya fue aceptada.'),
  ).toBeVisible()
  await expect(
    section.getByRole('button', { name: 'Reenviar la invitación a j***@example.test' }),
  ).toHaveCount(0)

  await section.getByRole('button', { name: 'Reenviar la invitación a l***@example.test' }).click()

  await expect(section.locator('[data-team-invitation-outcome]')).toContainText(
    'El primer correo sigue sirviendo',
  )
  const resends = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/resends'),
  )
  expect(resends).toHaveLength(1)
  expect(resends[0]?.path).toBe(
    `/backoffice/v1/organizations/${gym.organization.organization_id}/team-invitations/${live.invitation_id}/resends`,
  )
  expect(resends[0]?.body).toEqual({})
  expect(resends[0]?.headers['idempotency-key']).toBeTruthy()
})

test('an expired invitation is replaced by a new one Allfit signs, and the old one stays expired', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const expired = teamInvitationRecord({
    contact_hint: 'e***@example.test',
    state: 'expired',
    proposed_role_code: 'staff',
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      teamInvitations: { lists: { [gym.organization.organization_id]: [expired] } },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  const section = page.locator('[data-team-invitations]')
  await section.getByRole('button', { name: 'Reenviar la invitación a e***@example.test' }).click()

  await expect(section.locator('[data-team-invitation-outcome]')).toContainText(
    'firmada por Allfit',
  )
  await expect(section.locator('[data-team-invitation]')).toHaveCount(2)
  const renewed = section.locator('[data-team-invitation][data-state="pending"]')
  await expect(renewed.getByText('Allfit, al reenviar una vencida')).toBeVisible()
  await expect(renewed.getByRole('cell', { name: 'Staff', exact: true })).toBeVisible()
  await expect(
    section.locator('[data-team-invitation][data-state="expired"] [data-team-invitation-reason]'),
  ).toContainText('Ya se reemplazó por otra')
})

test('a resend lost to the network is retried with the same command, so nobody gets two emails', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  const live = teamInvitationRecord({ contact_hint: 'l***@example.test' })
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [gym] },
    teamInvitations: { lostResends: 1, lists: { [gym.organization.organization_id]: [live] } },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  const section = page.locator('[data-team-invitations]')
  const resend = section.getByRole('button', {
    name: 'Reenviar la invitación a l***@example.test',
  })

  await resend.click()
  await expect(section.locator('[data-team-invitation-failure]')).toContainText(
    'No hay conexión con el API.',
  )
  await resend.click()
  await expect(section.locator('[data-team-invitation-outcome]')).toContainText(
    'El primer correo sigue sirviendo',
  )

  const attempts = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/resends'),
  )
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['idempotency-key']).toBe(attempts[0]?.headers['idempotency-key'])
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
})

test('a resend over the daily limit says the gym’s own invitations count too', async ({
  context,
  page,
}) => {
  const gym = operatingGym()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      teamInvitations: {
        resendRefusal: { status: 429, code: 'rate-limited' },
        lists: { [gym.organization.organization_id]: [teamInvitationRecord()] },
      },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)
  await page.getByRole('button', { name: 'Reenviar la invitación a l***@example.test' }).click()

  await expect(page.locator('[data-team-invitation-failure]')).toContainText(
    'contando las del gimnasio',
  )
})

test('without the support duty the section says which duty it needs', async ({ context, page }) => {
  const gym = operatingGym()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [gym] },
      teamInvitations: { refusal: { status: 403, code: 'forbidden' }, lists: {} },
    }),
  )

  await page.goto(`/organizations/${gym.organization.organization_id}`)

  await expect(page.locator('[data-team-invitations]')).toContainText('deber de soporte')
  // The refusal is the section's alone: the rest of the file still opens.
  await expect(page.getByRole('heading', { name: gym.organization.display_name })).toBeVisible()
})

test('a gym nobody claimed has no team invitations to resend', async ({ context, page }) => {
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

  await expect(page.getByText('Sin dueño: nadie ha reclamado el gimnasio.')).toBeVisible()
  await expect(page.locator('[data-team-invitations]')).toHaveCount(0)
  expect(fixture.requests.some((request) => request.path.endsWith('/team-invitations'))).toBe(false)
})
