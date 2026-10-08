import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  type ErasureRequestEntryFixture,
} from './backoffice-api-mock'

const PATH = '/erasure-requests'

function day(offset: number): string {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString()
}

function openRequest(
  overrides: Partial<ErasureRequestEntryFixture> = {},
): ErasureRequestEntryFixture {
  return {
    id: '019ac000-0000-7000-8000-000000000501',
    subject_person_id: '019ac000-0000-7000-8000-000000000005',
    origin: 'request',
    status: 'open',
    opened_at: day(-27),
    closed_at: null,
    due_at: day(3),
    pending_items: 1,
    suspended_items: 0,
    resolved_items: 1,
    categories: [
      {
        data_classification_code: 'body',
        action: 'delete',
        status: 'executed',
        items: 2,
        item_ids: ['019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000602'],
        result: 'deleted',
        executed_at: day(-27),
        retained_until: null,
        hold: null,
      },
      {
        data_classification_code: 'health',
        action: 'delete',
        status: 'pending',
        items: 1,
        item_ids: ['019ae000-0000-7000-8000-000000000603'],
        result: null,
        executed_at: null,
        retained_until: null,
        hold: null,
      },
    ],
    ...overrides,
  }
}

test('shows what is still owed, with the ones past the thirty days called out', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    erasureRequests: {
      requests: [
        openRequest(),
        openRequest({
          id: '019ac000-0000-7000-8000-000000000502',
          subject_person_id: '019ac000-0000-7000-8000-000000000006',
          opened_at: day(-40),
          due_at: day(-10),
          pending_items: 0,
          suspended_items: 1,
          resolved_items: 0,
          categories: [
            {
              data_classification_code: 'nutrition',
              action: 'delete',
              status: 'suspended',
              items: 4,
              item_ids: ['019ae000-0000-7000-8000-000000000604'],
              result: null,
              executed_at: null,
              retained_until: null,
              hold: {
                id: '019ae000-0000-7000-8000-000000000701',
                reason_code: 'judicial_order',
                valid_to: day(60),
              },
            },
          ],
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)
  // A laptop screen: the six columns fit without scrolling sideways.
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto(PATH)

  const summary = page.locator('[data-erasure-summary]')
  await expect(summary).toContainText('2 solicitudes abiertas')
  await expect(summary).toContainText('1 pasada de los 30 días')

  const table = page.getByRole('table', { name: 'Solicitudes de eliminación' })
  // The oldest request is answered first, so it is the first row.
  const rows = table.locator('[data-erasure-row]')
  await expect(rows.first()).toContainText('019ac000-0000-7000-8000-000000000006')
  await expect(rows.first()).toContainText('10 días de retraso')
  await expect(rows.first()).toContainText('en espera por una obligación legal')
  await expect(rows.nth(1)).toContainText('Faltan 3 días')
  await expect(rows.nth(1)).toContainText('Cuerpo · eliminado (2)')
  await expect(rows.nth(1)).toContainText('Salud · pendiente de eliminar (1)')

  const region = page.getByRole('region', { name: 'Solicitudes de eliminación' })
  expect(await region.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)

  // The panel tracks the request; it never carries what was erased.
  await expect(page.getByText(/kg|peso|medición/i)).toHaveCount(0)

  const reads = fixture.requests.filter((request) =>
    request.path.startsWith('/backoffice/v1/erasure-requests'),
  )
  expect(reads[0]?.query).toContain('status=open')
})

test('reads the resolved half only when it is asked for', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    erasureRequests: {
      requests: [
        openRequest({
          id: '019ac000-0000-7000-8000-000000000503',
          status: 'closed',
          opened_at: day(-12),
          closed_at: day(-12),
          due_at: day(18),
          pending_items: 0,
          suspended_items: 0,
          resolved_items: 1,
          categories: [
            {
              data_classification_code: 'body',
              action: 'delete',
              status: 'executed',
              items: 3,
              item_ids: ['019ae000-0000-7000-8000-000000000605'],
              result: 'deleted',
              executed_at: day(-12),
              retained_until: null,
              hold: null,
            },
          ],
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.locator('[data-erasure-empty]')).toContainText(
    'No hay solicitudes de eliminación pendientes',
  )

  await page.getByRole('button', { name: 'Resueltas' }).click()

  await expect(page.locator('[data-erasure-summary]')).toContainText('1 solicitud resuelta')
  const table = page.getByRole('table', { name: 'Solicitudes de eliminación' })
  await expect(table.locator('[data-erasure-row]')).toContainText('Cuerpo · eliminado (3)')
  await expect(table.locator('[data-erasure-row]')).toContainText('Nada pendiente')

  const reads = fixture.requests.filter((request) =>
    request.path.startsWith('/backoffice/v1/erasure-requests'),
  )
  expect(reads.at(-1)?.query).toContain('status=closed')
})

test('suspends a category by an obligation, and the panel then says so', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    erasureRequests: { requests: [openRequest()] },
  })
  await mockBackofficeApi(context, fixture)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Suspender', exact: true }).first().click()

  const form = page.locator('[data-erasure-hold-form]')
  await expect(form).toContainText('No da acceso a nada')

  // The form will not let a hold leave without an end date.
  await form.getByRole('button', { name: 'Suspender', exact: true }).click()
  await expect(form).toContainText('Describe qué cubre la suspensión')
  expect(
    fixture.requests.filter((request) => request.path === '/backoffice/v1/legal-holds'),
  ).toHaveLength(0)

  await form.getByLabel('Alcance').fill('Mediciones del expediente 2026-114')
  await form.getByLabel('Referencia del requerimiento').fill('JUZGADO-2026-114')
  await form.getByRole('button', { name: 'Suspender', exact: true }).click()
  await expect(form).toContainText('No existen suspensiones indefinidas')

  await form.getByLabel('Vigente hasta').fill(day(60).slice(0, 10))
  await form.getByRole('checkbox').first().check()
  await form.getByRole('button', { name: 'Suspender', exact: true }).click()

  const table = page.getByRole('table', { name: 'Solicitudes de eliminación' })
  await expect(table.locator('[data-erasure-row]')).toContainText('orden judicial')
  await expect(table.locator('[data-erasure-row]')).toContainText(
    'en espera por una obligación legal',
  )

  const applied = fixture.requests.filter(
    (request) => request.path === '/backoffice/v1/legal-holds',
  )
  expect(applied).toHaveLength(1)
  expect(applied[0]?.body).toMatchObject({
    reason_code: 'judicial_order',
    case_reference: 'JUZGADO-2026-114',
    disposition_item_ids: ['019ae000-0000-7000-8000-000000000603'],
  })
})

test('says what releasing will do before it does it', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    erasureRequests: {
      requests: [
        openRequest({
          pending_items: 0,
          suspended_items: 1,
          categories: [
            {
              data_classification_code: 'health',
              action: 'delete',
              status: 'suspended',
              items: 1,
              item_ids: ['019ae000-0000-7000-8000-000000000603'],
              result: null,
              executed_at: null,
              retained_until: null,
              hold: {
                id: '019ae000-0000-7000-8000-000000000701',
                reason_code: 'regulatory_request',
                valid_to: day(30),
              },
            },
          ],
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto(PATH)
  await page.locator('[data-erasure-release]').first().click()

  const confirm = page.locator('[data-erasure-release-confirm]')
  await expect(confirm).toContainText('la eliminación sigue su curso')
  expect(fixture.requests.filter((request) => request.path.includes('/release'))).toHaveLength(0)

  await confirm.getByRole('button', { name: 'Confirmar liberación' }).click()

  await expect(page.getByRole('table', { name: 'Solicitudes de eliminación' })).toContainText(
    'pendiente de eliminar',
  )
  expect(fixture.requests.filter((request) => request.path.includes('/release'))).toHaveLength(1)
})

test('a separation conflict is explained as itself, not as a refusal', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    erasureRequests: {
      requests: [openRequest()],
      nextHoldRefusal: { status: 403, code: 'separation-of-duties' },
    },
  })
  await mockBackofficeApi(context, fixture)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Suspender', exact: true }).first().click()

  const form = page.locator('[data-erasure-hold-form]')
  await form.getByLabel('Alcance').fill('Mediciones del expediente 2026-114')
  await form.getByLabel('Referencia del requerimiento').fill('JUZGADO-2026-114')
  await form.getByLabel('Vigente hasta').fill(day(60).slice(0, 10))
  await form.getByRole('checkbox').first().check()
  await form.getByRole('button', { name: 'Suspender', exact: true }).click()

  const failure = page.locator('[data-erasure-failure]')
  await expect(failure).toContainText('acceso excepcional')
  await expect(failure).not.toContainText('manage_privacy_requests')
})

test('explains a refused read as the duty it needs, not as a failure', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      erasureRequests: { refusal: { status: 403, code: 'forbidden' }, requests: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.locator('[data-erasure-failure]')).toContainText('manage_privacy_requests')
  await expect(page.getByRole('table', { name: 'Solicitudes de eliminación' })).toHaveCount(0)
})
