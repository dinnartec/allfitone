import { expect, test } from '@playwright/test'

import {
  SUPPORT_SUBJECT_ID,
  accountRecoveryRequest,
  accountRecoveryState,
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  supportPerson,
  type AccountRecoveryFixture,
} from './backoffice-api-mock'

const CASE = 'CASE-2026-001'
const HINT = '••••••••on@example.test'
const CARD = `/people/${SUPPORT_SUBJECT_ID}?case_reference=${CASE}`

function fixtureWith(accountRecovery: AccountRecoveryFixture) {
  return createBackofficeFixture({
    session: activeSession(),
    support: { people: [supportPerson()] },
    accountRecovery,
  })
}

function commands(fixture: ReturnType<typeof fixtureWith>) {
  return fixture.requests.filter(
    (request) => request.method === 'POST' && request.path.includes('/account-recoveries'),
  )
}

test('support sends the official recovery to the verified email, and nothing on the card edits the person', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith({ states: { [SUPPORT_SUBJECT_ID]: accountRecoveryState() } })
  await mockBackofficeApi(context, fixture)

  await page.goto(CARD)

  const section = page.locator('[data-account-recovery]')
  await expect(section.getByRole('heading', { name: 'Recuperación de acceso' })).toBeVisible()
  await expect(section.getByRole('textbox')).toHaveCount(0)
  await expect(section.getByText('No se ha iniciado ninguna recuperación')).toBeVisible()

  await section.getByRole('button', { name: `Enviar la recuperación a ${HINT}` }).click()

  await expect(section.locator('[data-account-recovery-outcome]')).toContainText(
    'solo la persona puede usar el enlace',
  )
  const started = section.locator('[data-account-recovery-request][data-state="initiated"]')
  await expect(started.getByText('Todavía no sale')).toBeVisible()
  await expect(section.locator('[data-account-recovery-start]')).toHaveCount(0)

  const sent = commands(fixture)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.path).toBe(`/backoffice/v1/people/${SUPPORT_SUBJECT_ID}/account-recoveries`)
  expect(sent[0]?.body).toEqual({ case_reference: CASE })
  expect(sent[0]?.headers['idempotency-key']).toBeTruthy()
  const reads = fixture.requests.filter((request) => request.path.endsWith('/account-recovery'))
  expect(reads.every((request) => request.query.includes(`case_reference=${CASE}`))).toBe(true)
})

test('without a verified email the card fails closed and offers nothing else', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith({
      states: {
        [SUPPORT_SUBJECT_ID]: accountRecoveryState({
          availability: 'unavailable',
          unavailable_reason: 'no_verified_email',
          contact_hint: null,
          can_start: false,
        }),
      },
    }),
  )

  await page.goto(CARD)

  const unavailable = page.locator('[data-account-recovery-unavailable]')
  await expect(unavailable.getByText('Recuperación no disponible', { exact: true })).toBeVisible()
  await expect(unavailable).toContainText('no se aceptan fotos de documentos')
  await expect(unavailable).toContainText('recuperación no disponible')
  await expect(page.locator('[data-account-recovery] button')).toHaveCount(0)
})

test('a live recovery is resent to the same address, and an expired one is never offered again', async ({
  context,
  page,
}) => {
  const live = accountRecoveryRequest()
  const fixture = fixtureWith({
    states: { [SUPPORT_SUBJECT_ID]: accountRecoveryState({ can_start: false, requests: [live] }) },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(CARD)
  const section = page.locator('[data-account-recovery]')
  await section.getByRole('button', { name: `Reenviar la recuperación a ${HINT}` }).click()

  await expect(section.locator('[data-account-recovery-outcome]')).toContainText(
    'la misma dirección',
  )
  const sent = commands(fixture)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.path).toBe(
    `/backoffice/v1/people/${SUPPORT_SUBJECT_ID}/account-recoveries/${live.request_id}/resends`,
  )
  expect(sent[0]?.body).toEqual({ case_reference: CASE })
  await expect(
    section
      .locator('[data-account-recovery-request]')
      .getByRole('cell', { name: '2', exact: true }),
  ).toBeVisible()
})

test('an expired recovery offers only a new start, and says its link never works again', async ({
  context,
  page,
}) => {
  const expired = accountRecoveryRequest({
    state: 'expired',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    resendable: false,
    cancellable: false,
  })
  await mockBackofficeApi(
    context,
    fixtureWith({
      states: { [SUPPORT_SUBJECT_ID]: accountRecoveryState({ requests: [expired] }) },
    }),
  )

  await page.goto(CARD)
  const section = page.locator('[data-account-recovery]')
  const row = section.locator('[data-account-recovery-request][data-state="expired"]')

  await expect(row).toContainText('no vuelve a funcionar')
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(
    section.getByRole('button', { name: `Enviar la recuperación a ${HINT}` }),
  ).toBeVisible()
})

test('a suspicious recovery is cancelled only after confirming, honest about an email that left', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith({
    states: {
      [SUPPORT_SUBJECT_ID]: accountRecoveryState({
        can_start: false,
        requests: [accountRecoveryRequest()],
      }),
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(CARD)
  const section = page.locator('[data-account-recovery]')
  await section.getByRole('button', { name: `Cancelar la recuperación enviada a ${HINT}` }).click()

  await expect(section.locator('[data-account-recovery-confirm]')).toContainText(
    'no se puede retirar',
  )
  expect(commands(fixture)).toHaveLength(0)

  await section.getByRole('button', { name: 'Sí, cancelar' }).click()

  await expect(section.locator('[data-account-recovery-outcome]')).toContainText(
    'usarlo ya no la confirma',
  )
  await expect(
    section.locator('[data-account-recovery-request][data-state="cancelled"]'),
  ).toBeVisible()
  expect(commands(fixture)[0]?.path.endsWith('/cancellation')).toBe(true)
})

test('a start lost to the network is retried with the same command, so nobody gets two emails', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith({
    lostCommands: 1,
    states: { [SUPPORT_SUBJECT_ID]: accountRecoveryState() },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(CARD)
  const section = page.locator('[data-account-recovery]')
  const start = section.getByRole('button', { name: `Enviar la recuperación a ${HINT}` })

  await start.click()
  await expect(section.locator('[data-account-recovery-failure]')).toContainText(
    'No hay conexión con el API.',
  )
  await start.click()
  await expect(section.locator('[data-account-recovery-outcome]')).toBeVisible()

  const attempts = commands(fixture)
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['idempotency-key']).toBe(attempts[0]?.headers['idempotency-key'])
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
})

test('the six states read differently, and a failure says why', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    fixtureWith({
      states: {
        [SUPPORT_SUBJECT_ID]: accountRecoveryState({
          can_start: false,
          requests: [
            accountRecoveryRequest({ state: 'initiated', delivered_at: null, resendable: false }),
            accountRecoveryRequest({ state: 'awaiting_verification' }),
            accountRecoveryRequest({
              state: 'confirmed',
              confirmed_at: new Date().toISOString(),
              resendable: false,
              cancellable: false,
            }),
            accountRecoveryRequest({ state: 'expired', resendable: false, cancellable: false }),
            accountRecoveryRequest({
              state: 'cancelled',
              cancelled_at: new Date().toISOString(),
              resendable: false,
              cancellable: false,
            }),
            accountRecoveryRequest({
              state: 'failed',
              failed_at: new Date().toISOString(),
              failure_code: 'contact_changed',
              resendable: false,
              cancellable: false,
            }),
          ],
        }),
      },
    }),
  )

  await page.goto(CARD)
  const section = page.locator('[data-account-recovery]')

  for (const label of [
    'Iniciada',
    'Esperando verificación',
    'Confirmada',
    'Vencida',
    'Cancelada',
    'Fallida',
  ]) {
    await expect(
      section.locator('[data-account-recovery-request]').getByText(label, { exact: true }),
    ).toBeVisible()
  }
  await expect(section.locator('[data-state="failed"]')).toContainText(
    'correo verificado de la persona cambió',
  )
})

test('over the daily limit the card says how many emails already went', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith({
      commandRefusal: { status: 429, code: 'rate-limited' },
      states: { [SUPPORT_SUBJECT_ID]: accountRecoveryState() },
    }),
  )

  await page.goto(CARD)
  await page.getByRole('button', { name: `Enviar la recuperación a ${HINT}` }).click()

  await expect(page.locator('[data-account-recovery-failure]')).toContainText('24 horas')
})

test('without the support duty the section says which duty it needs, and the card still opens', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith({ refusal: { status: 403, code: 'forbidden' }, states: {} }),
  )

  await page.goto(CARD)

  await expect(page.locator('[data-account-recovery]')).toContainText('deber de soporte')
  await expect(page.getByRole('heading', { name: 'Estado operativo' })).toBeVisible()
})
