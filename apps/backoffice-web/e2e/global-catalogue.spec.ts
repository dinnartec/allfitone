import { expect, test } from '@playwright/test'

import {
  activeSession,
  catalogueEntry,
  createBackofficeFixture,
  globalCatalogueFixture,
  mockBackofficeApi,
  type GlobalCatalogueFixture,
} from './backoffice-api-mock'

function fixtureWith(globalCatalogue: GlobalCatalogueFixture) {
  return createBackofficeFixture({ session: activeSession(), globalCatalogue })
}

function commands(fixture: ReturnType<typeof fixtureWith>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.includes('/catalogue'),
  )
}

test('Allfit publishes a discipline and it becomes available to choose from', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(globalCatalogueFixture())
  await mockBackofficeApi(context, fixture)

  await page.goto('/catalogue')

  const disciplines = page.locator('[data-catalogue-section="discipline"]')
  await expect(disciplines.getByText('Todavía no hay nada publicado aquí.')).toBeVisible()

  await disciplines.getByLabel('Código').fill('test_global_yoga')
  await disciplines.getByLabel('Nombre').fill('Yoga')
  await disciplines.getByRole('button', { name: 'Publicar disciplina' }).click()

  await expect(page.locator('[data-catalogue-outcome]')).toContainText('gimnasios y personas')
  await expect(disciplines.locator('[data-catalogue-entry]')).toHaveCount(1)

  const sent = commands(fixture)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.path).toBe('/backoffice/v1/catalogue/disciplines')
  expect(sent[0]?.body).toEqual({ code: 'test_global_yoga', name: 'Yoga' })
  expect(sent[0]?.headers['idempotency-key']).toBeTruthy()

  // The published discipline is what an activity type can be published under.
  const activityTypes = page.locator('[data-catalogue-section="activity_type"]')
  await expect(activityTypes.getByRole('combobox', { name: 'Disciplina' })).toBeEnabled()
})

test('nothing on the screen offers to publish a gym’s content as global', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith(globalCatalogueFixture({ disciplines: [catalogueEntry()] })),
  )

  await page.goto('/catalogue')

  const labels = await page.locator('[data-global-catalogue] label').allInnerTexts()
  expect(labels.some((label) => /gimnasio|organizaci|dueñ|alcance/i.test(label))).toBe(false)
  await expect(page.getByRole('textbox', { name: /gimnasio/i })).toHaveCount(0)
})

test('a code that already names something else is refused, with the reason', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith(
      globalCatalogueFixture({
        disciplines: [catalogueEntry()],
        commandRefusal: { status: 409, code: 'conflict' },
      }),
    ),
  )

  await page.goto('/catalogue')
  const disciplines = page.locator('[data-catalogue-section="discipline"]')
  await disciplines.getByLabel('Código').fill('test_global_yoga')
  await disciplines.getByLabel('Nombre').fill('Pilates')
  await disciplines.getByRole('button', { name: 'Publicar disciplina' }).click()

  await expect(page.locator('[data-catalogue-failure]')).toContainText('ya nombra otra cosa')
})

test('a malformed code never becomes a request', async ({ context, page }) => {
  const fixture = fixtureWith(globalCatalogueFixture())
  await mockBackofficeApi(context, fixture)

  await page.goto('/catalogue')
  const disciplines = page.locator('[data-catalogue-section="discipline"]')
  await disciplines.getByLabel('Código').fill('Yoga Global')
  await disciplines.getByLabel('Nombre').fill('Yoga')
  await disciplines.getByRole('button', { name: 'Publicar disciplina' }).click()

  await expect(disciplines.getByText(/El código va en minúsculas/)).toBeVisible()
  expect(commands(fixture)).toHaveLength(0)
})

test('archiving says what depends on the entry and asks before withdrawing it', async ({
  context,
  page,
}) => {
  const movement = catalogueEntry({
    kind: 'movement',
    code: null,
    name: 'Guerrero II',
    in_use_count: 3,
  })
  const fixture = fixtureWith(
    globalCatalogueFixture({ disciplines: [catalogueEntry()], movements: [movement] }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/catalogue')
  const movements = page.locator('[data-catalogue-section="movement"]')
  await expect(movements.getByText('3 referencias', { exact: false })).toBeVisible()

  await movements.getByRole('button', { name: 'Archivar Guerrero II' }).click()
  await expect(movements.locator('[data-catalogue-confirm]')).toContainText('sigue funcionando')
  expect(commands(fixture)).toHaveLength(0)

  await movements.getByRole('button', { name: 'Sí, archivar' }).click()

  await expect(page.locator('[data-catalogue-outcome]')).toContainText('Sale de las búsquedas')
  await expect(movements.locator('[data-catalogue-entry][data-status="archived"]')).toBeVisible()
  expect(commands(fixture)[0]?.path).toBe(
    `/backoffice/v1/catalogue/movements/${movement.id}/archival`,
  )
  expect(commands(fixture)[0]?.body).toEqual({})
})

test('a discipline whose content is still published is not archived, and the screen says why', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith(
      globalCatalogueFixture({
        disciplines: [catalogueEntry()],
        activityTypes: [
          catalogueEntry({ kind: 'activity_type', code: 'test_global_flow', name: 'Flow' }),
        ],
      }),
    ),
  )

  await page.goto('/catalogue')
  const disciplines = page.locator('[data-catalogue-section="discipline"]')
  await disciplines.getByRole('button', { name: 'Archivar Yoga' }).click()
  await disciplines.getByRole('button', { name: 'Sí, archivar' }).click()

  await expect(page.locator('[data-catalogue-failure]')).toContainText(
    'todavía tiene contenido publicado',
  )
})

test('an archived entry is shown as archived and offers no archive button', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith(
      globalCatalogueFixture({
        disciplines: [catalogueEntry({ status: 'archived' })],
      }),
    ),
  )

  await page.goto('/catalogue')
  const row = page.locator('[data-catalogue-entry][data-status="archived"]')

  await expect(row.getByText('Archivado')).toBeVisible()
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(row.locator('[data-catalogue-reason]')).toContainText('fuera de las búsquedas')
})

test('a publication lost to the network is retried with the same command', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(globalCatalogueFixture({ lostCommands: 1 }))
  await mockBackofficeApi(context, fixture)

  await page.goto('/catalogue')
  const disciplines = page.locator('[data-catalogue-section="discipline"]')
  await disciplines.getByLabel('Código').fill('test_global_yoga')
  await disciplines.getByLabel('Nombre').fill('Yoga')
  const publish = disciplines.getByRole('button', { name: 'Publicar disciplina' })

  await publish.click()
  await expect(page.locator('[data-catalogue-failure]')).toContainText(
    'No hay conexión con el API.',
  )
  await publish.click()
  await expect(page.locator('[data-catalogue-outcome]')).toBeVisible()

  const attempts = commands(fixture)
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['idempotency-key']).toBe(attempts[0]?.headers['idempotency-key'])
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
})

test('equipment is declared absent instead of shown as an empty catalogue', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(context, fixtureWith(globalCatalogueFixture()))

  await page.goto('/catalogue')

  await expect(page.locator('[data-catalogue-equipment]')).toContainText('no existe dónde ponerlo')
})

test('without the curation duty the screen says which duty it needs', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    fixtureWith(globalCatalogueFixture({ refusal: { status: 403, code: 'forbidden' } })),
  )

  await page.goto('/catalogue')

  await expect(page.locator('[data-global-catalogue]')).toContainText('deber de curaduría')
  await expect(page.locator('[data-catalogue-section="discipline"]')).toHaveCount(0)
})
