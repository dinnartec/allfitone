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

test('reuses organization commands for unchanged retries and rotates after editing', async ({
  page,
}) => {
  let attempts = 0
  const fixture = createStudioApiFixture({
    intercept: (request) => {
      if (request.method !== 'POST' || request.path !== '/studio/v1/organizations') {
        return undefined
      }
      attempts += 1
      return attempts <= 2 ? { status: 503, body: error('upstream-unavailable') } : undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: /Trabajo por mi cuenta/ }).click()

  const name = page.getByLabel('Nombre visible')
  const create = page.getByRole('button', { name: /Crear mi espacio/ })
  await create.click()
  await expect(page.getByText(/No pudimos crear el espacio/)).toBeVisible()
  await create.click()
  await expect.poll(() => organizationWrites(fixture).length).toBe(2)

  const [first, second] = organizationWrites(fixture)
  expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key'])
  expect(second?.headers['command-id']).toBe(first?.headers['command-id'])

  await name.fill('Espacio de rendimiento')
  await create.click()
  await expect.poll(() => organizationWrites(fixture).length).toBe(3)

  const third = organizationWrites(fixture)[2]
  expect(third?.headers['idempotency-key']).not.toBe(first?.headers['idempotency-key'])
  expect(third?.headers['command-id']).not.toBe(first?.headers['command-id'])
})

test('keeps activation step commands stable and rotates only the edited completion', async ({
  page,
}) => {
  let completionAttempts = 0
  const fixture = createStudioApiFixture({
    session: {
      authenticated: true,
      registration_status: 'registration_incomplete',
      identity: {},
    },
    intercept: (request) => {
      if (request.method === 'POST' && request.path === '/studio/v1/onboarding-attempts') {
        return {
          status: 201,
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
      if (request.method === 'POST' && request.path.endsWith('/eligibility-evidence')) {
        return {
          status: 201,
          body: {
            result: 'pass',
            evaluated_at: '2026-08-12T12:00:00.000Z',
            policy: {
              code: 'adult_eligibility',
              version: 1,
              minimum_age: 18,
              jurisdiction: 'CO',
              evidence_kind: 'self_declaration',
            },
          },
        }
      }
      if (request.method === 'POST' && request.path.endsWith('/completion')) {
        completionAttempts += 1
        return completionAttempts <= 2
          ? { status: 503, body: error('upstream-unavailable') }
          : { status: 200, body: { registration_status: 'complete' } }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/')

  const givenName = page.getByLabel('Nombres')
  await givenName.fill('Ada')
  await page.getByLabel('Apellidos').fill('Lovelace')
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
  const complete = page.getByRole('button', { name: /Confirmar mi identidad/ })

  await complete.click()
  await expect(page.getByText(/No pudimos guardar/)).toBeVisible()
  await complete.click()
  await expect.poll(() => completionWrites(fixture).length).toBe(2)

  const [firstEvidence, secondEvidence] = eligibilityWrites(fixture)
  const [firstCompletion, secondCompletion] = completionWrites(fixture)
  expect(secondEvidence?.headers['idempotency-key']).toBe(firstEvidence?.headers['idempotency-key'])
  expect(secondEvidence?.headers['command-id']).toBe(firstEvidence?.headers['command-id'])
  expect(secondCompletion?.headers['idempotency-key']).toBe(
    firstCompletion?.headers['idempotency-key'],
  )
  expect(secondCompletion?.headers['command-id']).toBe(firstCompletion?.headers['command-id'])

  await givenName.fill('Adriana')
  await complete.click()
  await expect.poll(() => completionWrites(fixture).length).toBe(3)

  const thirdEvidence = eligibilityWrites(fixture)[2]
  const thirdCompletion = completionWrites(fixture)[2]
  expect(thirdEvidence?.headers['idempotency-key']).toBe(firstEvidence?.headers['idempotency-key'])
  expect(thirdEvidence?.headers['command-id']).toBe(firstEvidence?.headers['command-id'])
  expect(thirdCompletion?.headers['idempotency-key']).not.toBe(
    firstCompletion?.headers['idempotency-key'],
  )
  expect(thirdCompletion?.headers['command-id']).not.toBe(firstCompletion?.headers['command-id'])
})

test('keeps the session active after returning from independent space setup twice', async ({
  page,
}) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)
  await page.goto('/')

  const independent = page.getByRole('button', { name: 'Trabajo por mi cuenta' })
  for (let visit = 0; visit < 2; visit += 1) {
    await independent.click()
    await expect(page.getByRole('heading', { name: 'Dale nombre a tu espacio.' })).toBeVisible()
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(page.getByRole('heading', { name: '¿Cómo trabajas hoy?' })).toBeVisible()
  }

  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path === '/studio/v1/auth/logout',
    ),
  ).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
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

test('keeps the active organization and its roles visible in the workspace', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, terminatedMembership, secondActiveMembership],
  })
  await installStudioApiMock(page, fixture)

  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Gimnasio', { exact: true })).toBeVisible()
  await expect(page.getByText('Propietario', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Cambiar de organización')).toBeVisible()
  await expect(page.getByText(terminatedMembership.display_name)).toHaveCount(0)
})

test('replaces the organization context without retaining the previous workspace', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership],
    intercept: async (request) => {
      if (
        request.method === 'GET' &&
        request.path === '/studio/v1/me/memberships' &&
        page.url().includes(secondActiveMembership.organization_id)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await page.getByLabel('Cambiar de organización').click()
  await page.getByRole('option', { name: `${secondActiveMembership.display_name} · Coach` }).click()

  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toHaveCount(0)
  await expect(page).toHaveURL(`/organizations/${secondActiveMembership.organization_id}`)
  await expect(
    page.getByRole('heading', { name: secondActiveMembership.display_name, level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Coach', { exact: true })).toBeVisible()
  await expect(page.getByText('Propietario', { exact: true })).toHaveCount(0)

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))
  expect(JSON.stringify(storage)).not.toContain(activeMembership.organization_id)
  expect(JSON.stringify(storage)).not.toContain(secondActiveMembership.organization_id)
})

test('blocks direct access to a terminated organization membership', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, terminatedMembership],
  })
  await installStudioApiMock(page, fixture)

  await page.goto(`/organizations/${terminatedMembership.organization_id}`)

  await expect(page.getByText('Este espacio no está disponible')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Elegir otro espacio' })).toBeVisible()
  await expect(page.getByText(terminatedMembership.display_name)).toHaveCount(0)
})

test('revalidates a restored workspace and blocks a membership that ended', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership],
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toBeVisible()

  fixture.memberships = [
    { ...activeMembership, status: 'terminated', ended_at: '2026-08-10T12:00:00.000Z' },
    secondActiveMembership,
  ]
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))

  await expect(page.getByText('Este espacio no está disponible')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toHaveCount(0)
})

test('recovers from a temporary organization context failure without exposing content', async ({
  page,
}) => {
  let available = false
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) =>
      request.method === 'GET' && request.path === '/studio/v1/me/memberships' && !available
        ? { status: 503, body: error('upstream-unavailable') }
        : undefined,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByText('No pudimos comprobar tu acceso')).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)

  available = true
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toBeVisible()
})

test('returns an expired organization session to the access landing', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) =>
      request.method === 'GET' && request.path === '/studio/v1/me/memberships'
        ? { status: 401, body: error('unauthenticated') }
        : undefined,
  })
  await installStudioApiMock(page, fixture)

  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)
})

test('switches by keyboard and browser history does not restore the previous organization', async ({
  page,
}) => {
  const memberships = [activeMembership, secondActiveMembership]
  const fixture = createStudioApiFixture({
    memberships,
    me: { profile: null, memberships },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/account')
  await page.getByRole('button', { name: 'Mis espacios' }).click()

  const firstMembership = page
    .locator('[data-membership-card]')
    .filter({ hasText: activeMembership.display_name })
  await firstMembership.getByRole('button', { name: 'Entrar al espacio' }).click()
  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}`)

  await page.getByLabel('Cambiar de organización').focus()
  await page.keyboard.press('Enter')
  const secondOption = page.getByRole('option', {
    name: `${secondActiveMembership.display_name} · Coach`,
  })
  await secondOption.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/organizations/${secondActiveMembership.organization_id}`)

  await page.goBack()
  await expect(page).toHaveURL('/account')
  await expect(
    page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
  ).toHaveCount(0)
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

test.describe('organization context on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the active organization and switcher inside the viewport', async ({ page }) => {
    const fixture = createStudioApiFixture({
      memberships: [activeMembership, secondActiveMembership],
    })
    await installStudioApiMock(page, fixture)
    await page.goto(`/organizations/${activeMembership.organization_id}`)

    await expect(
      page.getByRole('heading', { name: activeMembership.display_name, level: 1 }),
    ).toBeVisible()
    await expect(page.getByLabel('Cambiar de organización')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})

function organizationWrites(fixture: ReturnType<typeof createStudioApiFixture>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path === '/studio/v1/organizations',
  )
}

function eligibilityWrites(fixture: ReturnType<typeof createStudioApiFixture>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/eligibility-evidence'),
  )
}

function completionWrites(fixture: ReturnType<typeof createStudioApiFixture>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/completion'),
  )
}
