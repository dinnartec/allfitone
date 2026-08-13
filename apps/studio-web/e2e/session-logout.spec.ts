import { expect, test } from '@playwright/test'

import { activeMembership, createStudioApiFixture, installStudioApiMock } from './studio-api-mock'

const STUDIO_ORIGIN = 'http://127.0.0.1:3101'

test('ignores a manual logout form submission without explicit button activation', async ({
  page,
}) => {
  const fixture = createStudioApiFixture()
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '¿Cómo trabajas hoy?' })).toBeVisible()

  await page.locator('form:has(input[name="reason"][value="manual"])').evaluate((form) => {
    ;(form as HTMLFormElement).requestSubmit()
  })

  await expect(page.getByRole('heading', { name: '¿Cómo trabajas hoy?' })).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path === '/studio/v1/auth/logout',
    ),
  ).toHaveLength(0)
})

test('clears the browser session and browser history cannot reveal the workspace', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)

  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).not.toBeVisible()
  await expect(page.locator('[data-session-lock]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('allfit-studio-session:v1')
        if (!raw) return undefined
        const record = JSON.parse(raw) as { status?: string; confirmedAt?: number }
        return record.status === 'ended' && typeof record.confirmedAt === 'number'
      }),
    )
    .toBe(true)
  expect(
    fixture.requests.some(
      (request) =>
        request.method === 'POST' &&
        request.path === '/studio/v1/auth/logout' &&
        request.body === 'reason=manual',
    ),
  ).toBe(true)
})

test('shows a non-actionable closing state while manual logout is in flight', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await page.evaluate(() => {
    HTMLFormElement.prototype.submit = function recordPendingLogout() {
      document.documentElement.dataset.logoutPending = 'true'
    }
  })

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await expect(page.getByRole('heading', { name: 'Cerrando tu sesión' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cerrando tu sesión' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Completar cierre' })).toHaveCount(0)
  await expect(page.locator('[data-session-closing]')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-logout-pending', 'true')
  await expect(page.locator('[data-session-content]')).toHaveCount(0)
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)
})

test('a manual logout covers another Studio tab immediately', async ({ context, page }) => {
  const other = await context.newPage()
  let releaseLogout: (() => void) | undefined
  let recordLogoutRequest: (() => void) | undefined
  const logoutRelease = new Promise<void>((resolve) => {
    releaseLogout = resolve
  })
  const logoutRequested = new Promise<void>((resolve) => {
    recordLogoutRequest = resolve
  })
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: async (request, current) => {
      if (request.method !== 'POST' || request.path !== '/studio/v1/auth/logout') return undefined
      recordLogoutRequest?.()
      await logoutRelease
      current.signedOut = true
      return { status: 303, headers: { Location: `${STUDIO_ORIGIN}/` } }
    },
  })
  await installStudioApiMock(page, fixture)
  await installStudioApiMock(other, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await other.goto(`/organizations/${activeMembership.organization_id}`)
  await expect(other.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()

  const logoutNavigation = page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await logoutRequested

  await expect(other.locator('[data-session-closing]')).toBeVisible()
  await expect(
    other.locator('[data-session-closing]').getByRole('button', { name: 'Completar cierre' }),
  ).toHaveCount(0)
  await expect(other.getByText(activeMembership.display_name)).not.toBeVisible()

  releaseLogout?.()
  await logoutNavigation
  await expect(other).toHaveURL('/')
  await expect(other.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await expect(other.locator('[data-session-closing]')).toHaveCount(0)
})

test('locks at thirty minutes and deliberate activity resets the deadline', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-10T12:00:00.000Z') })
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
  await page.evaluate(() => {
    HTMLFormElement.prototype.requestSubmit = function recordIdleLogout() {
      const reason = new FormData(this).get('reason')
      document.documentElement.dataset.logoutReason = typeof reason === 'string' ? reason : ''
    }
  })

  await page.clock.fastForward(30 * 60 * 1000 - 1_000)
  await expect(page.locator('[data-session-lock]')).toHaveCount(0)

  await page.keyboard.press('Tab')
  await page.clock.fastForward(1_000)
  await expect(page.locator('[data-session-lock]')).toHaveCount(0)

  await page.clock.fastForward(30 * 60 * 1000)
  await expect(page.locator('[data-session-closing]')).toBeVisible()
  await expect(
    page.locator('[data-session-closing]').getByRole('button', { name: 'Completar cierre' }),
  ).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-logout-reason', 'inactivity')
  await expect(page.locator('[data-session-content]')).toHaveCount(0)
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)
})

test('shows a recoverable notice when only the browser logout can be confirmed', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    intercept: (request, current) => {
      if (request.method !== 'POST' || request.path !== '/studio/v1/auth/logout') return undefined
      current.signedOut = true
      return { status: 303, headers: { Location: `${STUDIO_ORIGIN}/?logout=partial` } }
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/')
  await page.getByRole('button', { name: 'Esperar una invitación' }).click()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await expect(page.getByText('La sesión se cerró en este equipo')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('offers reauthentication when a restored page retains the secure logout lock', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({ signedOut: true })
  await installStudioApiMock(page, fixture)
  await page.addInitScript(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({ version: 1, status: 'ended', endedAt: Date.now() }),
    )
  })

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  await expect(page.locator('[data-session-lock]')).toHaveCount(0)
  await page.getByRole('link', { name: 'Entrar a Studio' }).evaluate((link) => {
    link.addEventListener('click', (event) => event.preventDefault(), { once: true })
    ;(link as HTMLElement).click()
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('allfit-studio-session:v1')))
    .toBeNull()
})

test('requires explicit recovery when a locally ended session is still authenticated', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.addInitScript(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({
        version: 1,
        status: 'ended',
        endedAt: Date.now(),
      }),
    )
  })

  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByRole('heading', { name: 'Tu sesión está protegida' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Completar cierre' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)

  await page.getByRole('button', { name: 'Completar cierre' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
  const recovery = fixture.requests.find(
    (request) => request.method === 'POST' && request.path === '/studio/v1/auth/logout',
  )
  expect(recovery?.body).toBe('reason=recovery')
})

test('keeps recovery visible on verification failure and retries without mounting content', async ({
  page,
}) => {
  let sessionChecks = 0
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (request.method === 'GET' && request.path === '/studio/v1/session') {
        sessionChecks += 1
        if (sessionChecks === 1) {
          return { status: 503, body: { error: { code: 'upstream-unavailable' } } }
        }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.addInitScript(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({
        version: 1,
        status: 'ended',
        endedAt: Date.now(),
        reason: 'inactivity',
      }),
    )
  })

  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toHaveCount(0)
  fixture.signedOut = true
  await page.getByRole('button', { name: 'Reintentar' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
})

test('keeps recovery locked when session verification has no network', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  let abortVerification = true
  await page.route('http://127.0.0.1:8080/studio/v1/session', async (route) => {
    if (abortVerification) {
      abortVerification = false
      await route.abort('failed')
      return
    }
    await route.fallback()
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({
        version: 1,
        status: 'ended',
        endedAt: Date.now(),
        reason: 'manual',
      }),
    )
  })

  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await expect(page.getByRole('heading', { name: 'Tu sesión está protegida' })).toBeVisible()
  await expect(page.getByText('Solicitaste cerrar la sesión.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.locator('[data-session-content]')).toHaveCount(0)
  fixture.signedOut = true
  await page.getByRole('button', { name: 'Reintentar' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Entrar a Studio' })).toBeVisible()
})

test('preserves a pending team invitation while session recovery completes', async ({ page }) => {
  const invitationToken = 'A'.repeat(43)
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.addInitScript((token) => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({ version: 1, status: 'ended', endedAt: Date.now() }),
    )
    sessionStorage.setItem('allfit-invitation-token:v1', token)
  }, invitationToken)

  await page.goto('/')
  await page.getByRole('button', { name: 'Completar cierre' }).click()

  await expect(page).toHaveURL('/invitations')
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('allfit-invitation-token:v1')))
    .toBe(invitationToken)
})
