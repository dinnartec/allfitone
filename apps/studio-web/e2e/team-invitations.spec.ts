import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  secondActiveMembership,
} from './studio-api-mock'

test('owner proposes a staff invitation without exposing contact in the URL', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  // Issuing an invitation starts from the team directory. The workspace home
  // reports the organization's state and links to the section that acts.
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await page.getByRole('link', { name: 'Ver equipo', exact: true }).click()
  await expect(page).toHaveURL(/\/team$/)

  await page.getByRole('link', { name: 'Invitar integrante', exact: true }).click()
  await expect(page).toHaveURL(/\/team\/invitations\/new$/)
  await page.getByLabel('Correo electrónico').fill('person@example.test')
  await page.getByRole('button', { name: 'Enviar invitación' }).click()

  await expect(page.getByRole('heading', { name: 'La propuesta quedó pendiente.' })).toBeVisible()
  await expect(page.getByText('p***@example.test')).toBeVisible()
  await expect(page).not.toHaveURL(/person%40example\.test|person@example\.test/)

  // The workspace home reads pending invitations, so match the command itself
  // rather than the first request that happens to touch the collection.
  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/invitations'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('cancel returns a directly opened form to the invitation list', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team/invitations/new`)

  await page.getByRole('button', { name: 'Cancelar' }).click()

  await expect(page).toHaveURL(
    `/organizations/${activeMembership.organization_id}/team/invitations`,
  )
})

// A role that cannot invite is told so in place, the way the directory does it.
// It used to reach a failure state with a "Reintentar" that could never work,
// and a "Nueva invitación" heading above a message saying the opposite.
test('a coach keeps the invitations section, is refused in place, and never reads the register', async ({
  page,
}) => {
  const coach = { ...secondActiveMembership, roles: ['coach'] }
  const fixture = createStudioApiFixture({ memberships: [coach] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${coach.organization_id}/team`)

  const sectionNavigation = page.getByRole('navigation', { name: 'Secciones del equipo' })
  await sectionNavigation.getByRole('link', { name: 'Invitaciones' }).click()
  await expect(page).toHaveURL(`/organizations/${coach.organization_id}/team/invitations`)
  await expect(sectionNavigation.getByRole('link', { name: 'Invitaciones' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await expect(page.getByText('No puedes consultar las invitaciones')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ver roles y permisos' })).toBeVisible()
  expect(fixture.requests.filter(isInvitationListRequest)).toHaveLength(0)
})

test('a coach opening the invitation form directly lands on the refusal, not on an empty promise', async ({
  page,
}) => {
  const coach = { ...secondActiveMembership, roles: ['coach'] }
  const fixture = createStudioApiFixture({ memberships: [coach] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${coach.organization_id}/team/invitations/new`)

  await expect(page).toHaveURL(`/organizations/${coach.organization_id}/team/invitations`)
  await expect(page.getByRole('heading', { name: 'Invitaciones', level: 1 })).toBeVisible()
  await expect(page.getByText('No puedes consultar las invitaciones')).toBeVisible()
})

function isInvitationListRequest(request: { method: string; path: string }): boolean {
  return request.method === 'GET' && /\/organizations\/[^/]+\/invitations$/.test(request.path)
}
