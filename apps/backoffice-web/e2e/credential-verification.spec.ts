import { expect, test, type Page } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  renewalDue,
  verificationRequest,
} from './backoffice-api-mock'

const PATH = '/verifications'

async function fillSource(page: Page, validTo?: string) {
  await page.getByLabel('Autoridad consultada').fill('RETHUS')
  await page.getByLabel('Jurisdicción').fill('CO')
  await page.getByLabel('Referencia en la fuente').fill('TP-12345')
  await page.getByLabel('Lo que dijo la fuente').fill('Vigente')
  if (validTo) await page.getByLabel('La fuente dice que vence').fill(validTo)
}

function decisions(fixture: ReturnType<typeof createBackofficeFixture>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path === '/backoffice/v1/verifications',
  )
}

test('says who asked, what they claim and where to check it', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [verificationRequest()], renewals: [] },
    }),
  )

  await page.goto(PATH)

  await expect(
    page.getByRole('heading', { name: 'Licencia o matrícula profesional · Tarjeta profesional' }),
  ).toBeVisible()
  await expect(page.getByText('Valentina Ríos')).toBeVisible()
  await expect(page.getByText('TP-12345')).toBeVisible()
  await expect(page.getByText(/Registro oficial\. Busca el número/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir el registro' })).toHaveAttribute(
    'href',
    'https://registro.example.test/TP-12345',
  )
})

test('there is no default result, so nothing is sent until one is chosen', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    verification: { requests: [verificationRequest()], renewals: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()

  for (const name of ['Verificado', 'Rechazado', 'No verificable']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }

  await fillSource(page)
  await page.getByRole('button', { name: 'Registrar decisión' }).click()

  await expect(page.getByText(/No hay uno por defecto/)).toBeVisible()
  expect(decisions(fixture)).toHaveLength(0)
})

test('offers nowhere to attach a document', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [verificationRequest()], renewals: [] },
    }),
  )

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()

  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByText(/no se sube ni se guarda ningún documento/)).toBeVisible()
})

test('the validity is a consequence, never a field', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    verification: { requests: [verificationRequest()], renewals: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()

  await expect(page.getByText(/vence como máximo en 12 meses/)).toBeVisible()
  await expect(page.getByLabel(/Vigencia|Válid[oa] hasta/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Verificado', exact: true }).click()
  await fillSource(page)
  await page.getByRole('button', { name: 'Registrar decisión' }).click()

  await expect(page.getByText(/Verificado hasta el/)).toBeVisible()
  await expect(page.getByText(/Ningún otro dato de esta persona queda verificado/)).toBeVisible()
  await expect(page.locator('[data-verification-request]')).toHaveCount(0)

  const sent = decisions(fixture)
  expect(sent).toHaveLength(1)
  const body = sent[0]?.body as Record<string, unknown>
  expect(body.result).toBe('verified')
  expect(body.method).toBe('official_registry_lookup')
  // What the server derives never travels, so a client cannot pick its own validity.
  for (const derived of ['valid_to', 'valid_from', 'policy_code', 'evidence_fingerprint']) {
    expect(body).not.toHaveProperty(derived)
  }
  expect(sent[0]?.headers['idempotency-key']).toBeTruthy()
  expect(sent[0]?.headers['command-id']).toBeTruthy()
})

test('insufficient evidence is recorded as an answer, not as a failure', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [verificationRequest()], renewals: [] },
    }),
  )

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()
  await page.getByRole('button', { name: 'No verificable', exact: true }).click()

  await expect(page.getByText(/Es una respuesta válida, no un error/)).toBeVisible()

  await fillSource(page)
  await page.getByRole('button', { name: 'Registrar decisión' }).click()

  await expect(page.getByText(/Quedó registrado como «No verificable»/)).toBeVisible()
  await expect(page.getByText('Hecho')).toBeVisible()
  await expect(page.getByText('No se aplicó')).toHaveCount(0)
})

test('a conflict is stated before anyone tries', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [verificationRequest({ viewer_can_decide: false })], renewals: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText(/No puedes decidir sobre este título/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Decidir' })).toHaveCount(0)
})

test('a source that says the title lapsed cannot verify it', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    verification: { requests: [verificationRequest()], renewals: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()
  await page.getByRole('button', { name: 'Verificado', exact: true }).click()
  await fillSource(page, '2020-01-01T00:00')
  await page.getByRole('button', { name: 'Registrar decisión' }).click()

  await expect(page.getByText(/ya venció, así que no puede quedar verificado/)).toBeVisible()
  expect(decisions(fixture)).toHaveLength(0)
})

test('a request decided elsewhere in the meantime is explained and leaves the queue', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: {
        nextDecisionDecidedElsewhere: true,
        requests: [verificationRequest()],
        renewals: [],
      },
    }),
  )

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Decidir' }).click()
  await page.getByRole('button', { name: 'Rechazado', exact: true }).click()
  await fillSource(page)
  await page.getByRole('button', { name: 'Registrar decisión' }).click()

  await expect(page.getByText(/ya no está pendiente/)).toBeVisible()
  await expect(page.locator('[data-verification-request]')).toHaveCount(0)
})

test('a lapsed verification is renewed as a new request, never extended', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [], renewals: [renewalDue()] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText(/Venció el/)).toBeVisible()
  await page.getByRole('button', { name: 'Abrir renovación' }).click()

  await expect(page.getByText(/La verificación anterior queda como estaba/)).toBeVisible()
  await expect(page.locator('[data-verification-renewal]')).toHaveCount(0)
  await expect(page.locator('[data-verification-request]')).toHaveCount(1)
  await expect(page.getByText('Renovación', { exact: true })).toBeVisible()
})

test('a withdrawn verification duty is explained as expiry by design', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { refusal: { status: 403, code: 'forbidden' }, requests: [], renewals: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No se pudo leer la cola de verificación')).toBeVisible()
  await expect(page.getByText(/Los deberes vencen por diseño/)).toBeVisible()
})

test('an empty queue says what will fill it', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      verification: { requests: [], renewals: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No hay títulos esperando verificación')).toBeVisible()
  await expect(page.getByText(/sin que tenga que pedirlo/)).toBeVisible()
})
