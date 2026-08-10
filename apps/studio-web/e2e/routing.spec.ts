import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  secondActiveMembership,
  terminatedMembership,
} from './studio-api-mock'

test('offers creation or an explicit invitation wait without professional setup', async ({
  page,
}) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)

  await page.goto('/')

  await expect(page.getByRole('heading', { name: '¿Cómo trabajas hoy?' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mi cuenta', exact: true })).toHaveCount(0)
  await expect(page.getByText(/perfil profesional/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Trabajo por mi cuenta' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tengo un equipo o centro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Esperar una invitación' })).toBeVisible()
  await expect(page.getByText(/práctica/i)).toHaveCount(0)
})

test('waits without mutations and rechecks an empty membership list', async ({ page }) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)
  await page.goto('/')

  const wait = page.getByRole('button', { name: 'Esperar una invitación' })
  await wait.focus()
  await page.keyboard.press('Enter')

  await expect(
    page.getByRole('heading', { name: 'Tu espacio puede llegar después.' }),
  ).toBeVisible()
  await expect(page.getByText('Sin membresías activas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  expect(fixture.requests.filter((request) => request.method !== 'GET')).toHaveLength(0)

  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()
  await expect(page.getByText('Sin membresías activas')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'GET' && request.path === '/studio/v1/me/memberships',
    ),
  ).toHaveLength(2)
})

test('enters a newly active membership from the invitation wait', async ({ page }) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: 'Esperar una invitación' }).click()

  fixture.memberships = [terminatedMembership, activeMembership]
  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()

  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)
  await expect(page.getByText(activeMembership.display_name)).toBeVisible()
})

test('opens the selector when multiple memberships arrive during the wait', async ({ page }) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: 'Esperar una invitación' }).click()

  fixture.memberships = [activeMembership, secondActiveMembership]
  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()

  await expect(page.getByRole('heading', { name: '¿Dónde quieres trabajar hoy?' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toBeVisible()
  await expect(page.getByText(secondActiveMembership.display_name)).toBeVisible()
})

test('returns an expired waiting session to the access landing', async ({ page }) => {
  let membershipReads = 0
  const fixture = createStudioApiFixture({
    intercept: (request) => {
      if (request.method !== 'GET' || request.path !== '/studio/v1/me/memberships') {
        return undefined
      }
      membershipReads += 1
      return membershipReads === 2 ? { status: 401, body: error('unauthenticated') } : undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: 'Esperar una invitación' }).click()

  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()

  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
})

test('recovers when checking memberships fails temporarily', async ({ page }) => {
  let membershipReads = 0
  const fixture = createStudioApiFixture({
    intercept: (request) => {
      if (request.method !== 'GET' || request.path !== '/studio/v1/me/memberships') {
        return undefined
      }
      membershipReads += 1
      return membershipReads === 2
        ? { status: 503, body: error('upstream-unavailable') }
        : undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: 'Esperar una invitación' }).click()

  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()
  await expect(page.getByText('La comprobación no terminó')).toBeVisible()

  fixture.memberships = [activeMembership]
  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click()
  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)
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

test.describe('invitation wait on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps actions inside the viewport', async ({ page }) => {
    const fixture = createStudioApiFixture()
    await installStudioApiMock(page, fixture)
    await page.goto('/')
    await page.getByRole('button', { name: 'Esperar una invitación' }).click()

    await expect(page.getByRole('button', { name: 'Comprobar de nuevo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
})
