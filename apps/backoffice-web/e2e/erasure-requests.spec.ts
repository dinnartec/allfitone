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
        result: 'deleted',
        executed_at: day(-27),
        retained_until: null,
      },
      {
        data_classification_code: 'health',
        action: 'delete',
        status: 'pending',
        items: 1,
        result: null,
        executed_at: null,
        retained_until: null,
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
              result: null,
              executed_at: null,
              retained_until: null,
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
              result: 'deleted',
              executed_at: day(-12),
              retained_until: null,
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
