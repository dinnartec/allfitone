import { expect, test } from '@playwright/test'

import {
  SUPPORT_SUBJECT_EMAIL,
  SUPPORT_SUBJECT_ID,
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  personPaymentsRecord,
  supportPerson,
} from './backoffice-api-mock'

const CASE = 'CASE-2026-001'

function support(overrides: Parameters<typeof supportPerson>[0] = {}) {
  return { people: [supportPerson(overrides)] }
}

test('finds a person by an exact contact and carries the case into the card', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({ session: activeSession(), support: support() })
  await mockBackofficeApi(context, fixture)

  await page.goto('/people')
  await page.getByLabel('Referencia del caso').fill(CASE)
  await page.getByLabel('Dato exacto').fill(SUPPORT_SUBJECT_EMAIL)
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByRole('heading', { name: 'Persona encontrada' })).toBeVisible()
  await expect(page.getByText('••••••••on@example.test').first()).toBeVisible()

  // Rendered as a Link but announced as a button: that is how the Design System
  // composes a navigating action, here and everywhere else in this app.
  await page.getByRole('button', { name: 'Abrir estado operativo' }).click()

  await expect(page).toHaveURL(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)
  await expect(page.getByRole('heading', { name: 'Estado operativo' })).toBeVisible()

  const reads = fixture.requests.filter((request) =>
    request.path.startsWith('/backoffice/v1/support/'),
  )
  const searches = reads.filter((request) => request.path.endsWith('/support/people'))
  const cards = reads.filter((request) => request.path.includes(SUPPORT_SUBJECT_ID))

  // The search is user-initiated, so it happens exactly once. The card read is
  // effect-driven and React StrictMode double-invokes effects in dev, so its
  // count is not worth asserting: what matters is that it targeted the right
  // person, and that every support read carries the case it belongs to.
  expect(searches).toHaveLength(1)
  expect(cards.length).toBeGreaterThan(0)
  expect(reads.every((request) => request.query.includes(`case_reference=${CASE}`))).toBe(true)
})

test('says nothing was found rather than showing an empty result', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), support: { people: [] } }),
  )

  await page.goto('/people')
  await page.getByLabel('Referencia del caso').fill(CASE)
  await page.getByLabel('Dato exacto').fill('nadie@example.test')
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByText('No hay ninguna persona con ese dato')).toBeVisible()
  await expect(page.getByText(/quedó registrada de todos modos/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Persona encontrada' })).toBeHidden()
})

test('refuses to search without a traceable case reference', async ({ context, page }) => {
  const fixture = createBackofficeFixture({ session: activeSession(), support: support() })
  await mockBackofficeApi(context, fixture)

  await page.goto('/people')
  await page.getByLabel('Referencia del caso').fill('el usuario no puede entrar')
  await page.getByLabel('Dato exacto').fill(SUPPORT_SUBJECT_EMAIL)
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByText(/La referencia del caso va en mayúsculas/)).toBeVisible()
  expect(
    fixture.requests.filter((request) => request.path.startsWith('/backoffice/v1/support/')),
  ).toHaveLength(0)
})

test('refuses a malformed lookup before it becomes a recorded search', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({ session: activeSession(), support: support() })
  await mockBackofficeApi(context, fixture)

  await page.goto('/people')
  await page.getByLabel('Referencia del caso').fill(CASE)
  await page.getByRole('combobox', { name: 'Buscar por' }).click()
  await page.getByRole('option', { name: 'Teléfono exacto' }).click()
  await page.getByLabel('Dato exacto').fill('573001234567')
  await page.getByRole('button', { name: 'Buscar' }).click()

  await expect(page.getByText(/formato internacional/)).toBeVisible()
  expect(
    fixture.requests.filter((request) => request.path.startsWith('/backoffice/v1/support/')),
  ).toHaveLength(0)
})

test('never offers a search by name', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), support: support() }),
  )

  await page.goto('/people')
  await page.getByRole('combobox', { name: 'Buscar por' }).click()

  const options = await page.getByRole('option').allInnerTexts()
  expect(options).toEqual(['Identificador', 'Correo exacto', 'Teléfono exacto'])
})

test('shows what Allfit does not store instead of leaving the blocks out', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), support: support() }),
  )

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)

  await expect(
    page.getByRole('heading', { name: 'Lo que esta ficha todavía no puede decir' }),
  ).toBeVisible()
  for (const block of [
    'Relaciones de servicio',
    'Plan asignado',
    'Premium',
    'Permisos concedidos',
  ]) {
    await expect(page.getByRole('cell', { name: block })).toBeVisible()
  }
  // The distinction the API preserved has to survive into the screen.
  await expect(page.getByText('Allfit no lo guarda todavía').first()).toBeVisible()
  await expect(page.getByText(/no es una afirmación sobre la persona/).first()).toBeVisible()
})

test('shows what she pays, telling the charge that failed from the one that did not', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), support: support() }),
  )

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)

  const panel = page.locator('[data-payments-panel]')
  await expect(panel.getByText(/Tiene Pro porque se lo paga a Allfit por Apple/)).toBeVisible()
  // The amount is read from the ISO minor unit: 1.990.000 centavos are $19.900.
  await expect(panel.locator('[data-payments-charge]').first()).toContainText('19.900')
  await expect(panel.getByText('Cobrado', { exact: true })).toBeVisible()
  await expect(panel.getByText('No se cobró', { exact: true })).toBeVisible()
  await expect(panel.getByText(/motivo: billing_retry/)).toBeVisible()

  // Criterion 4, said out loud because its honesty is the point.
  await expect(panel.getByText(/no guarda datos de tarjeta/)).toBeVisible()

  // And what the gym charges, which Allfit does not record.
  await expect(panel.locator('[data-payments-bond]')).toContainText('Gimnasio Pagos')
  await expect(panel.locator('[data-payments-gym-note]')).toContainText('no guardamos los cobros')
})

test('a suspended subscription says since when, which is what a complaint needs', async ({
  context,
  page,
}) => {
  const live = personPaymentsRecord()
  const paused = personPaymentsRecord({
    pro: {
      ...live.pro,
      subscription: live.pro.subscription && {
        ...live.pro.subscription,
        status: 'suspended',
        suspended_at: '2026-10-05T12:00:00.000Z',
      },
    },
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      support: support(),
      supportPayments: { payments: paused },
    }),
  )

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)

  await expect(page.locator('[data-payments-state="suspended"]')).toContainText(
    'En pausa por falta de cobro desde el',
  )
})

test('the duty that opens the card does not open her money, and the panel says which one does', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      support: support(),
      supportPayments: { refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)

  // The card still loads: one duty refused is not the whole screen failing.
  await expect(page.getByRole('heading', { name: 'Estado operativo' })).toBeVisible()
  const refused = page.locator('[data-payments-refused]')
  await expect(refused).toContainText('view_billing_metadata')
  await expect(refused).toContainText('distinto del que abre su ficha')
})

test('will not open a card without the case that justifies the read', async ({ context, page }) => {
  const fixture = createBackofficeFixture({ session: activeSession(), support: support() })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}`)

  await expect(page.getByText('Esta ficha necesita una referencia de caso')).toBeVisible()
  expect(
    fixture.requests.filter((request) => request.path.startsWith('/backoffice/v1/support/')),
  ).toHaveLength(0)
})

test('explains a refused read as an expired duty, not as a generic error', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      support: { people: [], refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto(`/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`)

  await expect(page.getByText(/vencen por diseño/)).toBeVisible()
})

test('sends an unauthenticated operator back to the access screen', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture())

  await page.goto('/people')

  await expect(page.getByRole('heading', { name: 'Identifica tu acceso.' })).toBeVisible()
})
