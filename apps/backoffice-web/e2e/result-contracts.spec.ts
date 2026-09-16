import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  publishedCatalogue,
} from './backoffice-api-mock'

const ACTIVITY_TYPE_NAME = 'Sesión de fuerza de prueba'
const PATH = '/catalogue/result-contracts'

async function fillPublication(
  page: import('@playwright/test').Page,
  overrides: { code?: string; minimums?: string } = {},
) {
  await page.getByLabel('Código del contrato').fill(overrides.code ?? 'test.backoffice_front')
  // The identifier is chosen from the global catalogue, never typed.
  await page.getByRole('combobox', { name: 'Tipo de actividad' }).click()
  await page.getByRole('option', { name: ACTIVITY_TYPE_NAME }).click()
  await page.getByLabel('Mínimos por completitud').fill(overrides.minimums ?? '{"target_sets":1}')
  await page.getByLabel('Resultado esperado del caso aceptado').fill('accepted')
  await page.getByLabel('Resultado esperado del caso rechazado').fill('missing_sets')
}

test('publishes a version the server numbers and shows its demonstrated cases', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({ session: activeSession() })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.getByRole('heading', { name: 'Publicar reglas de validación' })).toBeVisible()
  await expect(page.getByText('Todavía no publicaste una versión')).toBeVisible()

  await fillPublication(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText('Publicada la versión 1 de test.backoffice_front')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Versión publicada' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Aceptado' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Rechazado' })).toBeVisible()

  const published = fixture.requests.find(
    (request) => request.method === 'POST' && request.path === '/backoffice/v1/result-contracts',
  )
  // The version number is the server's to assign; the client never proposes one.
  expect(published?.body).not.toHaveProperty('version_number')
  expect(published?.headers['idempotency-key']).toBeTruthy()
})

test('correcting a contract publishes the next version and closes the previous binding', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))

  await page.goto(PATH)
  await fillPublication(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()
  await expect(page.getByText('Publicada la versión 1 de test.backoffice_front')).toBeVisible()

  await fillPublication(page, { minimums: '{"target_sets":3}' })
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText('Publicada la versión 2 de test.backoffice_front')).toBeVisible()
  await expect(page.getByText('Esta publicación reemplazó una asociación anterior')).toBeVisible()
  await expect(page.getByText(/en lugar de\s+borrarse/)).toBeVisible()
})

test('refuses a suite that never demonstrates a refusal', async ({ context, page }) => {
  const fixture = createBackofficeFixture({ session: activeSession() })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await fillPublication(page)
  // Emptying the failing case leaves a contract nobody proved rejecting anything.
  await page.getByLabel('Resultado esperado del caso rechazado').fill('')
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText('Escribe qué se espera de este caso.')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path === '/backoffice/v1/result-contracts',
    ),
  ).toHaveLength(0)
})

test('refuses a malformed document before it travels', async ({ context, page }) => {
  const fixture = createBackofficeFixture({ session: activeSession() })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await fillPublication(page, { minimums: '{ not json' })
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText('Los mínimos deben ser un objeto JSON.')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path === '/backoffice/v1/result-contracts',
    ),
  ).toHaveLength(0)
})

test('answers the published-content guard with the next action', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      resultContracts: {
        versions: {},
        published: [],
        nextCommandFailure: { status: 409, code: 'conflict' },
      },
    }),
  )

  await page.goto(PATH)
  await fillPublication(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText(/publica la versión siguiente/)).toBeVisible()
})

test('explains a refusal as a missing curation duty', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      resultContracts: {
        versions: {},
        published: [],
        nextCommandFailure: { status: 403, code: 'forbidden' },
      },
    }),
  )

  await page.goto(PATH)
  await fillPublication(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText(/deber de curaduría del catálogo/)).toBeVisible()
})

test('deprecates the published version without deleting it', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))

  await page.goto(PATH)
  await fillPublication(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()
  await expect(page.getByRole('heading', { name: 'Versión publicada' })).toBeVisible()

  await page.getByRole('button', { name: 'Deprecar esta versión' }).click()

  await expect(page.getByText(/siguen válidas/)).toBeVisible()
  await expect(page.getByText('Deprecado', { exact: true })).toBeVisible()
  // The version is still on screen: deprecating is not deleting.
  await expect(page.getByText('test.backoffice_front · versión 1 · Fuerza')).toBeVisible()
})

test('sends an unauthenticated operator back to the access screen', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture())

  await page.goto(PATH)

  await expect(page.getByRole('heading', { name: 'Identifica tu acceso.' })).toBeVisible()
})

test('offers the published catalogue grouped by discipline instead of an identifier', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({ session: activeSession() })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('combobox', { name: 'Tipo de actividad' }).click()

  await expect(page.getByRole('option', { name: ACTIVITY_TYPE_NAME })).toBeVisible()
  await expect(page.getByText('Fuerza de prueba', { exact: true })).toBeVisible()
  await expect(page.getByText('Resistencia de prueba', { exact: true })).toBeVisible()

  await expect
    .poll(() => fixture.requests.filter((request) => request.path.startsWith('/catalog/v1')).length)
    .toBeGreaterThan(0)
})

test('shows what the chosen type already validates against, and what the version supersedes', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))

  await page.goto(PATH)
  await fillPublication(page)

  await expect(
    page.getByRole('heading', { name: 'Contratos vigentes de este tipo de actividad' }),
  ).toBeVisible()
  await expect(page.getByText('Ninguno vigente todavía')).toBeVisible()

  await page.getByRole('button', { name: 'Publicar versión' }).click()
  await expect(page.getByText('Publicada la versión 1 de test.backoffice_front')).toBeVisible()

  // The panel is re-read after the publication changed it.
  await expect(
    page.getByRole('cell', { name: 'test.backoffice_front v1 (por omisión)' }),
  ).toBeVisible()
  await expect(
    page.getByText('Publicar una versión nueva cierra la asociación vigente'),
  ).toBeVisible()
})

test('reports a catalogue it cannot read without pretending the screen still works', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      catalogue: { ...publishedCatalogue(), refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No se pudo leer el catálogo global')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Tipo de actividad' })).toBeDisabled()
})
