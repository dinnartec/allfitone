import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  scopeDefinition,
} from './backoffice-api-mock'

const PATH = '/permissions'

async function fillRule(
  page: import('@playwright/test').Page,
  values: { resource?: string; field?: string } = {},
) {
  await page.getByLabel('Recurso y campo 1').fill(values.resource ?? 'execution.body_measurements')
  await page.getByLabel('Campo de la regla 1').fill(values.field ?? 'weight_kg')
}

test('publishes the next version and says the earlier one still stands', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    scopes: { definitions: [scopeDefinition()] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await fillRule(page)
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText(/Publicada la versión 2 de Progreso corporal/)).toBeVisible()
  // The promise of criterion 3, said where the operator is looking.
  await expect(page.getByText(/Quien aceptó una versión anterior la conserva/)).toBeVisible()

  const published = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path === '/backoffice/v1/scope-definitions',
  )
  expect(published).toHaveLength(1)
  // The version number is the server's to assign.
  expect(published[0]?.body).not.toHaveProperty('version_number')
  expect(published[0]?.headers['idempotency-key']).toBeTruthy()
})

test('keeps the older version on screen instead of replacing it', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      scopes: {
        definitions: [
          scopeDefinition({ version_number: 1 }),
          scopeDefinition({ version_number: 2 }),
        ],
      },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('v2 · la más nueva')).toBeVisible()
  await expect(page.getByText('v1', { exact: true })).toBeVisible()
  await expect(page.getByText(/las anteriores siguen vigentes para quien las aceptó/)).toBeVisible()
})

test('shows what a permission excludes, not only what it includes', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      scopes: { definitions: [scopeDefinition()] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByRole('columnheader', { name: 'Queda fuera' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'nutrition.intake_entries' })).toBeVisible()
})

test('refuses a version that only excludes before it travels', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    scopes: { definitions: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await fillRule(page)
  await page.getByLabel('Excluir la regla 1').check()
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText(/sólo excluye no concede nada/)).toBeVisible()
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
})

test('refuses a malformed resource before it travels', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    scopes: { definitions: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await fillRule(page, { resource: 'Execution.Body Measurements' })
  await page.getByRole('button', { name: 'Publicar versión' }).click()

  await expect(page.getByText(/El recurso va en minúsculas/)).toBeVisible()
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
})

test('never offers reading backwards on something excluded', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), scopes: { definitions: [] } }),
  )

  await page.goto(PATH)
  await fillRule(page)
  await page.getByLabel('Excluir la regla 1').check()

  // The control is not merely validated: it is unavailable.
  await expect(page.getByLabel('Leer hacia atrás en la regla 1')).toBeDisabled()
})

test('explains the immutability guard as publishing the next version', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      scopes: { definitions: [], refusal: { status: 409, code: 'conflict' } },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText(/publica la versión siguiente/)).toBeVisible()
})

test('explains a refused publication as an expired curation duty', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      scopes: { definitions: [], refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText(/vencen por diseño/)).toBeVisible()
})

test('sends an unauthenticated operator back to the access screen', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture())

  await page.goto(PATH)

  await expect(page.getByRole('heading', { name: 'Identifica tu acceso.' })).toBeVisible()
})
