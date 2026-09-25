import { expect, test, type Locator } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  professionalCredential,
  professionalProfile,
  terminatedMembership,
} from './studio-api-mock'

test('keeps professional setup dormant until the person opts in', async ({ page }) => {
  const fixture = createStudioApiFixture({
    me: { profile: null, memberships: [activeMembership] },
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/account')

  await expect(page.getByRole('heading', { name: 'Tu cuenta de Studio' })).toBeVisible()
  await expect(page.getByText('Perfil profesional', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Configurar perfil profesional' })).toBeVisible()
  await expect(page.getByLabel('Titular profesional')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Credenciales/ })).toHaveCount(0)
  expect(
    fixture.requests.some((request) => request.path === '/studio/v1/professional-specialties'),
  ).toBe(false)
  expect(
    fixture.requests.some((request) => request.path === '/studio/v1/professional-credential-types'),
  ).toBe(false)

  await page.getByRole('button', { name: 'Configurar perfil profesional' }).click()

  await expect(page.getByRole('heading', { name: 'Configura tu perfil profesional' })).toBeVisible()
  await expect(page.getByLabel('Titular profesional')).toBeVisible()
  await expect(page.getByRole('tab', { name: /Credenciales/ })).toHaveCount(0)
})

test('presents an optional profile with active and terminated membership context', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [professionalCredential] },
      memberships: [activeMembership, terminatedMembership],
    },
  })
  await installStudioApiMock(page, fixture)

  await page.goto('/account')

  await expect(page.getByText('Perfil profesional', { exact: true })).toBeVisible()
  await expect(page.getByText('Perfil creado')).toBeVisible()
  await expect(page.getByText('Sus credenciales son opcionales', { exact: false })).toBeVisible()

  await page.getByRole('tab', { name: 'Vinculaciones' }).click()
  await expect(page.getByText('Vinculaciones activas')).toBeVisible()
  await expect(page.getByText('Vinculaciones finalizadas')).toBeVisible()
  await expect(page.getByText(activeMembership.display_name)).toBeVisible()
  await page.getByRole('button', { name: 'Historial de vinculaciones · 1' }).click()
  await expect(page.getByText(terminatedMembership.display_name)).toBeVisible()
  await expect(page.getByText('Finalizada', { exact: true })).toBeVisible()

  const lightKicker = page.locator('[data-profile-section] [data-profile-kicker]').first()
  expect(await contrastRatio(lightKicker)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('tab', { name: 'Credenciales', exact: true }).click()
  const evidence = page.getByRole('link', { name: 'Abrir evidencia declarada' })
  await expect(evidence).toHaveAttribute('rel', 'noopener noreferrer')
  expect(await contrastRatio(evidence)).toBeGreaterThanOrEqual(4.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('reuses command headers after ambiguous profile failures and rotates after editing', async ({
  page,
}) => {
  let attempts = 0
  const fixture = createStudioApiFixture({
    me: { profile: { ...professionalProfile }, memberships: [] },
    intercept: (request) => {
      if (request.method !== 'PUT' || request.path !== '/studio/v1/me/professional-profile') {
        return undefined
      }
      attempts += 1
      return attempts <= 2 ? { status: 503, body: error('unavailable') } : undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/account')

  const headline = page.getByLabel('Titular profesional')
  const save = page.getByRole('button', { name: 'Guardar cambios' })
  await headline.fill('Entrenadora de rendimiento')
  await save.click()
  await expect(page.getByText('El servicio no está disponible.', { exact: false })).toBeVisible()
  await save.click()
  await expect.poll(() => profileWrites(fixture).length).toBe(2)

  const [first, second] = profileWrites(fixture)
  expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key'])
  expect(second?.headers['command-id']).toBe(first?.headers['command-id'])

  await headline.fill('Entrenadora de rendimiento deportivo')
  await save.click()
  await expect(page.getByText('Tu presentación profesional quedó actualizada.')).toBeVisible()

  const third = profileWrites(fixture)[2]
  expect(third?.headers['idempotency-key']).not.toBe(first?.headers['idempotency-key'])
  expect(third?.headers['command-id']).not.toBe(first?.headers['command-id'])
})

test('collapses synchronous double submission into one profile mutation', async ({ page }) => {
  const fixture = createStudioApiFixture({
    me: { profile: { ...professionalProfile }, memberships: [] },
    intercept: async (request) => {
      if (request.method === 'PUT' && request.path === '/studio/v1/me/professional-profile') {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/account')
  await page.getByLabel('Titular profesional').fill('Entrenadora sin duplicados')

  await page.locator('[data-profile-editor] form').evaluate((form) => {
    const profileForm = form as HTMLFormElement
    profileForm.requestSubmit()
    profileForm.requestSubmit()
  })

  await expect(page.getByText('Tu presentación profesional quedó actualizada.')).toBeVisible()
  expect(profileWrites(fixture)).toHaveLength(1)
})

test('a delayed profile mutation cannot update a new cross-tab session', async ({
  context,
  page,
}) => {
  const controller = await context.newPage()
  let releaseWrite: (() => void) | undefined
  let observeWrite: (() => void) | undefined
  let completeWrite: (() => void) | undefined
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const writeObserved = new Promise<void>((resolve) => {
    observeWrite = resolve
  })
  const writeCompleted = new Promise<void>((resolve) => {
    completeWrite = resolve
  })
  const fixture = createStudioApiFixture({
    me: { profile: { ...professionalProfile }, memberships: [] },
    intercept: async (request) => {
      if (request.method !== 'PUT' || request.path !== '/studio/v1/me/professional-profile') {
        return undefined
      }
      observeWrite?.()
      await writeReleased
      completeWrite?.()
      return {
        status: 200,
        body: { ...professionalProfile, headline: 'Respuesta de la sesión anterior' },
      }
    },
  })
  await installStudioApiMock(controller, fixture)
  await installStudioApiMock(page, fixture)
  await controller.goto('/')
  await page.goto('/account')
  await page.getByLabel('Titular profesional').fill('Cambio todavía pendiente')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await writeObserved

  await controller.evaluate(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({ version: 1, status: 'ended', endedAt: Date.now(), reason: 'manual' }),
    )
  })
  await expect(page.locator('[data-session-closing]')).toBeVisible()

  fixture.me = {
    profile: { ...professionalProfile, id: 'new-session-profile', headline: 'Nueva identidad' },
    memberships: [],
  }
  await controller.evaluate(() => {
    localStorage.setItem(
      'allfit-studio-session:v1',
      JSON.stringify({ version: 1, status: 'active', lastActivityAt: Date.now() }),
    )
  })
  await expect(page.getByLabel('Titular profesional')).toHaveValue('Nueva identidad')

  releaseWrite?.()
  await writeCompleted

  await expect(page.getByLabel('Titular profesional')).toHaveValue('Nueva identidad')
  await expect(page.getByText('Respuesta de la sesión anterior')).toHaveCount(0)
  await expect(page.getByText('Tu presentación profesional quedó actualizada.')).toHaveCount(0)
})

test.describe('mobile and reduced motion', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the profile within the viewport', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const fixture = createStudioApiFixture({
      me: {
        profile: { ...professionalProfile, credentials: [professionalCredential] },
        memberships: [activeMembership, terminatedMembership],
      },
    })
    await installStudioApiMock(page, fixture)
    await page.goto('/account')

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByRole('button', { name: 'Mis espacios' })).toBeVisible()
  })
})

function profileWrites(fixture: ReturnType<typeof createStudioApiFixture>) {
  return fixture.requests.filter(
    (request) => request.method === 'PUT' && request.path === '/studio/v1/me/professional-profile',
  )
}

async function contrastRatio(locator: Locator): Promise<number> {
  const colors = await locator.evaluate((element) => {
    let ancestor: Element | null = element
    let background = 'rgba(0, 0, 0, 0)'
    while (ancestor) {
      const candidate = getComputedStyle(ancestor).backgroundColor
      if (!candidate.endsWith(', 0)') && candidate !== 'rgba(0, 0, 0, 0)') {
        background = candidate
        break
      }
      ancestor = ancestor.parentElement
    }
    return { foreground: getComputedStyle(element).color, background }
  })
  const foreground = luminance(parseRgb(colors.foreground))
  const background = luminance(parseRgb(colors.background))
  const lighter = Math.max(foreground, background)
  const darker = Math.min(foreground, background)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseRgb(value: string): [number, number, number] {
  const channels = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`)
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0]
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
}
