import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  secondActiveMembership,
  terminatedMembership,
} from './studio-api-mock'

test('keeps account and professional setup outside the initial onboarding', async ({ page }) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(page.getByRole('heading', { name: '¿Cómo trabajas hoy?' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mi cuenta', exact: true })).toHaveCount(0)
  await expect(page.getByText(/perfil profesional/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Crear mi espacio/ })).toBeVisible()
  await expect(page.getByText(/práctica/i)).toHaveCount(0)
})

test('routes one active membership directly and ignores terminated history', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, terminatedMembership],
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)
  await expect(page.getByRole('heading', { name: 'Tu espacio está listo.' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mi cuenta', exact: true })).toHaveCount(0)
  await expect(page.getByText(/perfil profesional/i)).toHaveCount(0)
})

test('shows the organization selector only for multiple active memberships', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, terminatedMembership, secondActiveMembership],
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(page.getByRole('heading', { name: '¿Dónde quieres trabajar hoy?' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toBeVisible()
  await expect(page.getByText(secondActiveMembership.display_name)).toBeVisible()
  await expect(page.getByText(terminatedMembership.display_name)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Mi cuenta', exact: true })).toHaveCount(0)
})

test('routes incomplete and expired sessions through the existing entry flow', async ({ page }) => {
  const fixture = createStudioApiFixture({
    session: {
      authenticated: true,
      registration_status: 'registration_incomplete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    },
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Confirma y deja tu identidad lista.' }),
  ).toBeVisible()
  await expect(page.getByText('Ada Lovelace')).toBeVisible()
})

test('returns unauthenticated sessions to the access landing', async ({ page }) => {
  const fixture = createStudioApiFixture({
    intercept: (request) =>
      request.path === '/studio/v1/session'
        ? { status: 401, body: error('unauthenticated') }
        : undefined,
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
})
