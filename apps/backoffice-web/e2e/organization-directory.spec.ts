import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  directoryOrganization,
  mockBackofficeApi,
} from './backoffice-api-mock'

const PATH = '/organizations'
const DIRECTORY = '/backoffice/v1/organizations'

test('lists the directory with name, type and state without asking for a filter', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationDirectory: {
      organizations: [
        directoryOrganization({ display_name: 'Gimnasio Norte', site_count: 2 }),
        directoryOrganization({ display_name: 'Estudio Sur', type_name: 'Estudio' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)

  await expect(page.locator('[data-organization-row]')).toHaveCount(2)
  await expect(page.getByRole('cell', { name: 'Gimnasio Norte' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Estudio', exact: true })).toBeVisible()
  await expect(page.getByText('2 gimnasios.')).toBeVisible()

  // Development mounts effects twice, so the count varies; what must hold is that
  // no read carried a filter the operator never set.
  const reads = fixture.requests.filter((request) => request.path === DIRECTORY)
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.every((request) => request.query === '')).toBe(true)
})

test('an unclaimed organization is told apart from one that operates', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: {
        organizations: [
          directoryOrganization({ display_name: 'Gimnasio Norte', status: 'active' }),
          directoryOrganization({ display_name: 'Gimnasio Nuevo', status: 'unclaimed' }),
        ],
      },
    }),
  )

  await page.goto(PATH)

  const unclaimed = page.locator('[data-organization-row][data-status="unclaimed"]')
  const active = page.locator('[data-organization-row][data-status="active"]')
  await expect(unclaimed).toHaveCount(1)
  await expect(unclaimed.getByText('Sin reclamar')).toBeVisible()
  await expect(active.getByText('Operando')).toBeVisible()
  await expect(unclaimed.getByText('Operando')).toHaveCount(0)
  await expect(page.getByText(/cuyo dueño todavía no aceptó: existe, pero no opera/)).toBeVisible()
})

test('an unknown number of people served is never shown as zero', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: { organizations: [directoryOrganization({ people_served: null })] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByRole('cell', { name: 'Sin dato aún' })).toBeVisible()
  await expect(page.getByText(/0 personas/)).toHaveCount(0)
  await expect(page.locator('[data-organization-people-served-note]')).toContainText(
    'un cero diría que no atiende a nadie',
  )
})

test('searches by name and sends the trimmed search', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationDirectory: {
      organizations: [
        directoryOrganization({ display_name: 'Gimnasio Norte' }),
        directoryOrganization({ display_name: 'Estudio Sur' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.locator('[data-organization-row]')).toHaveCount(2)
  await page.getByLabel('Nombre').fill('  norte ')
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.locator('[data-organization-row]')).toHaveCount(1)
  await expect(page.getByRole('cell', { name: 'Gimnasio Norte' })).toBeVisible()
  const reads = fixture.requests.filter((request) => request.path === DIRECTORY)
  expect(new URLSearchParams(reads.at(-1)?.query).get('q')).toBe('norte')
})

test('the legal name is not searched, because it can be a person', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: {
        organizations: [
          directoryOrganization({ display_name: 'Estudio Sol', legal_name: 'María Ramírez' }),
        ],
      },
    }),
  )

  await page.goto(PATH)
  await expect(page.locator('[data-organization-row]')).toHaveCount(1)
  await expect(page.getByText('María Ramírez')).toHaveCount(0)
  await page.getByLabel('Nombre').fill('Ramírez')
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByText('Ningún gimnasio coincide con esta búsqueda.')).toBeVisible()
  await expect(page.locator('[data-organization-row]')).toHaveCount(0)
})

test('a one-letter search is refused before it is sent', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationDirectory: { organizations: [directoryOrganization()] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.locator('[data-organization-row]')).toHaveCount(1)
  await page.getByLabel('Nombre').fill('g')
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByText(/al menos dos letras del nombre/)).toBeVisible()
  const searches = fixture.requests.filter(
    (request) => request.path === DIRECTORY && new URLSearchParams(request.query).has('q'),
  )
  expect(searches).toHaveLength(0)
})

test('narrows the directory to one state', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationDirectory: {
      organizations: [
        directoryOrganization({ display_name: 'Gimnasio Norte', status: 'active' }),
        directoryOrganization({ display_name: 'Gimnasio Nuevo', status: 'unclaimed' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.locator('[data-organization-row]')).toHaveCount(2)
  await page.getByRole('combobox', { name: 'Estado' }).click()
  await page.getByRole('option', { name: 'Sin reclamar', exact: true }).click()
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.locator('[data-organization-row]')).toHaveCount(1)
  await expect(page.locator('[data-organization-row][data-status="unclaimed"]')).toHaveCount(1)
  const reads = fixture.requests.filter((request) => request.path === DIRECTORY)
  expect(new URLSearchParams(reads.at(-1)?.query).get('status')).toBe('unclaimed')
})

test('pages through the directory without repeating or skipping anyone', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationDirectory: {
      pageSize: 2,
      organizations: [
        directoryOrganization({ display_name: 'Cancha Uno' }),
        directoryOrganization({ display_name: 'Acua Centro' }),
        directoryOrganization({ display_name: 'boxeo Libre' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.locator('[data-organization-row]')).toHaveCount(2)
  await expect(page.getByText(/Hay más/)).toBeVisible()
  await page.getByRole('button', { name: 'Ver más gimnasios' }).click()

  const rows = page.locator('[data-organization-row] td:first-child')
  await expect(rows).toHaveText(['Acua Centro', 'boxeo Libre', 'Cancha Uno'])
  await expect(page.getByRole('button', { name: 'Ver más gimnasios' })).toHaveCount(0)
  const reads = fixture.requests.filter((request) => request.path === DIRECTORY)
  expect(new URLSearchParams(reads.at(-1)?.query).get('cursor')).not.toBeNull()
})

test('a withdrawn duty is explained as expiry by design', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: { refusal: { status: 403, code: 'forbidden' }, organizations: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No se pudo leer el directorio')).toBeVisible()
  await expect(page.getByText(/Los deberes vencen por diseño/)).toBeVisible()
})

test('an empty directory says there are no gyms yet rather than that a search failed', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: { organizations: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('Todavía no hay ningún gimnasio en Allfit.')).toBeVisible()
  await expect(page.locator('[data-organization-people-served-note]')).toHaveCount(0)
})
