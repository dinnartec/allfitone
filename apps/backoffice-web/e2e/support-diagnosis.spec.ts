import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  diagnosisCircuit,
  diagnosisOperation,
  mockBackofficeApi,
} from './backoffice-api-mock'

const PATH = '/diagnosis'

test('a tripped channel is said first, before any individual failure', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: {
        circuits: [diagnosisCircuit({ state: 'open', failure_count: 12 })],
        operations: [diagnosisOperation()],
      },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('Un canal de entrega está caído')).toBeVisible()
  await expect(page.getByText(/causa más probable/)).toBeVisible()
})

test('a healthy platform says nothing rather than reassuring', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: { circuits: [diagnosisCircuit()], operations: [diagnosisOperation()] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByRole('heading', { name: 'Canales de entrega' })).toBeVisible()
  await expect(page.getByText('Un canal de entrega está caído')).toBeHidden()
})

test('a queue with nothing sent yet does not read as a wall of failures', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: {
        circuits: [],
        operations: [
          diagnosisOperation({ state: 'pending', attempt_count: 0, last_error_code: null }),
          diagnosisOperation({ state: 'dead_lettered', attempt_count: 7 }),
        ],
      },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByRole('cell', { name: 'Sin enviar todavía' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Se rindió' })).toBeVisible()
})

test('shows the five things the story asks for and nothing that carries content', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: { circuits: [], operations: [diagnosisOperation()] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByRole('cell', { name: 'identity.invitation_issued.v1' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Reintentando' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'smtp_timeout' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible()
  // The column that would carry a payload does not exist on this screen.
  await expect(page.getByRole('columnheader', { name: 'Contenido' })).toBeHidden()
})

test('filters the feed by state without asking for a case reference', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    diagnosis: {
      circuits: [],
      operations: [
        diagnosisOperation({ state: 'retrying' }),
        diagnosisOperation({ state: 'dead_lettered' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('combobox', { name: 'Estado' }).click()
  await page.getByRole('option', { name: 'Se rindió' }).click()

  await expect(page.getByRole('cell', { name: 'Reintentando' })).toBeHidden()

  const reads = fixture.requests.filter(
    (request) => request.path === '/backoffice/v1/support/operations',
  )
  expect(reads.some((request) => request.query.includes('state=dead_lettered'))).toBe(true)
  // No subject means nothing to trace to a case, so no case reference travels.
  expect(reads.every((request) => !request.query.includes('case_reference'))).toBe(true)
})

test('reaches the rest of the feed instead of stopping at the first page', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: {
        circuits: [],
        operations: Array.from({ length: 5 }, (_, index) =>
          diagnosisOperation({ label: `event.number-${index}.v1` }),
        ),
        pageSize: 2,
      },
    }),
  )

  await page.goto(PATH)

  const rows = page.getByRole('row').filter({ hasText: 'event.number-' })
  await expect(rows).toHaveCount(2)

  const more = page.getByRole('button', { name: 'Ver más operaciones' })
  await more.click()
  await expect(rows).toHaveCount(4)

  await more.click()
  await expect(rows).toHaveCount(5)
  await expect(more).toBeHidden()
})

test('explains a refused read as an expired duty, not as a generic error', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      diagnosis: {
        circuits: [],
        operations: [],
        refusal: { status: 403, code: 'forbidden' },
      },
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
