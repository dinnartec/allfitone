import { expect, test } from '@playwright/test'

import {
  BREAK_GLASS_PEER_ID,
  activeSession,
  breakGlassFile,
  createBackofficeFixture,
  mockBackofficeApi,
  openBreakGlassWindow,
} from './backoffice-api-mock'

const PATH = '/break-glass'
const SUBJECT = '019a3000-0000-7000-8000-000000000002'

test('offers only the categories that can be approved', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), breakGlass: { files: [] } }),
  )

  await page.goto(PATH)

  // Six, and the forbidden ones are absent rather than disabled: an option that can
  // never be granted is an invitation to try.
  await expect(page.getByRole('checkbox')).toHaveCount(6)
  await expect(page.getByRole('checkbox', { name: 'Contexto de salud' })).toBeVisible()
  for (const forbidden of ['Fotos', 'Pagos', 'Identidad', 'Toda la cuenta']) {
    await expect(page.getByRole('checkbox', { name: new RegExp(forbidden, 'i') })).toHaveCount(0)
  }
})

test('the tier is a consequence of the scope, never a field to choose', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: { files: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)

  // Nothing states a tier until a scope exists to derive one from.
  await expect(page.locator('[data-break-glass-consequence]')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Guía nutricional' }).click()
  await expect(
    page.getByText(/hace falta una aprobación y la ventana dura 30 minutos/),
  ).toBeVisible()

  // Adding a stricter category makes the window stricter. That is the only way to
  // move the tier: there is no control for it, for the approvals or for the minutes.
  await page.getByRole('checkbox', { name: 'Contexto de salud' }).click()
  await expect(page.getByText(/dos personas distintas y la ventana dura 15 minutos/)).toBeVisible()
  await expect(page.getByRole('combobox', { name: /Alcance|Aprobaciones|Duración/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /Aprobaciones|Duración|Minutos/ })).toHaveCount(0)
})

test('asks for a window without naming the tier, the quorum or the duration', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: { files: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByLabel('Persona afectada').fill(SUBJECT)
  await page.getByLabel('Referencia del caso').fill('CASE-2026-777')
  await page.getByRole('checkbox', { name: 'Contexto de salud' }).click()
  await page.getByRole('button', { name: 'Pedir la ventana' }).click()

  await expect(page.getByText(/Necesita aprobación de otra persona/)).toBeVisible()

  const posted = fixture.requests.filter(
    (request) =>
      request.method === 'POST' && request.path === '/backoffice/v1/break-glass/requests',
  )
  expect(posted).toHaveLength(1)
  const body = posted[0]?.body as Record<string, unknown>
  expect(body.case_reference).toBe('CASE-2026-777')
  expect(body.categories).toEqual(['health_context'])
  // The three derived facts are the server's. Sending them would be a second source
  // of truth for how expensive an exceptional access is.
  expect(body).not.toHaveProperty('sensitivity_tier')
  expect(body).not.toHaveProperty('required_approvals')
  expect(body).not.toHaveProperty('requested_duration_minutes')
  expect(posted[0]?.headers['idempotency-key']).toBeTruthy()
  expect(posted[0]?.headers['command-id']).toBeTruthy()
})

test('refuses a request with no scope instead of sending one', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: { files: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByLabel('Persona afectada').fill(SUBJECT)
  await page.getByLabel('Referencia del caso').fill('CASE-2026-778')
  await page.getByRole('button', { name: 'Pedir la ventana' }).click()

  await expect(page.getByText(/no existe acceso a «toda la cuenta»/)).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) =>
        request.method === 'POST' && request.path === '/backoffice/v1/break-glass/requests',
    ),
  ).toHaveLength(0)
})

test('one approval does not open a window that needs two', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: {
      files: [
        breakGlassFile({
          requester_person_id: BREAK_GLASS_PEER_ID,
          categories: ['health_context'],
          case_reference: 'CASE-2026-779',
          viewer_is_requester: false,
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await expect(page.getByText('0 de 2 aprobaciones. Faltan 2.')).toBeVisible()

  await page.getByRole('button', { name: 'Aprobar' }).click()

  await expect(page.getByText(/Falta otra persona para que la ventana se abra/)).toBeVisible()
  // Still waiting, and no longer this operator's to decide: the second approval has
  // to come from somebody else.
  await expect(page.getByText('Esperando aprobación')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Leer / })).toHaveCount(0)
  expect(fixture.breakGlass?.files[0]?.status).toBe('requested')
  expect(fixture.breakGlass?.files[0]?.window_ends_at).toBeNull()
})

test('a completed quorum opens the window and says how long it has left', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: {
      files: [
        breakGlassFile({
          requester_person_id: BREAK_GLASS_PEER_ID,
          categories: ['nutrition_guidance'],
          viewer_is_requester: false,
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Aprobar' }).click()

  await expect(page.getByText('La ventana quedó abierta.')).toBeVisible()
  await expect(page.getByText('Ventana abierta')).toBeVisible()
  await expect(
    page.getByText(/Quedan \d+ minutos de ventana\. No se puede extender\./),
  ).toBeVisible()
  // There is no extension, so there is no button offering one.
  await expect(page.getByRole('button', { name: /Extender|Ampliar|Renovar/ })).toHaveCount(0)
})

test('a rejection is final and offers no second chance', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: {
      files: [
        breakGlassFile({
          requester_person_id: BREAK_GLASS_PEER_ID,
          viewer_is_requester: false,
        }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Rechazar' }).click()

  await expect(page.getByText(/El rechazo es definitivo/)).toBeVisible()
  await expect(page.getByText('Rechazada', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0)
})

test('a window says how much is left and where it closes', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [openBreakGlassWindow(5, { categories: ['nutrition_guidance'] })] },
    }),
  )

  await page.goto(PATH)

  await expect(page.locator('[data-break-glass-window]')).toBeVisible()
  await expect(page.getByText(/Quedan 5 minutos de ventana/)).toBeVisible()
  await expect(page.getByText(/Para continuar después hay que pedir otra ventana/)).toBeVisible()
})

test('an authorised read that finds nothing is reported as recorded, not as a failure', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: { files: [openBreakGlassWindow(10, { categories: ['nutrition_guidance'] })] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Leer guía nutricional' }).click()

  const outcome = page.locator('[data-break-glass-outcome]')
  await expect(outcome).toBeVisible()
  await expect(outcome.getByText('Intento registrado', { exact: true })).toBeVisible()
  await expect(outcome.getByText(/el contenido todavía no existe en la plataforma/)).toBeVisible()
  // The person whose data it was sees the same attempt. Saying so is the point of
  // the screen, not a footnote.
  await expect(
    outcome.getByText(/verá este intento en su propio registro de accesos/),
  ).toBeVisible()

  const read = fixture.requests.filter((request) => request.path.endsWith('/reads'))
  expect(read).toHaveLength(1)
  expect((read[0]?.body as Record<string, unknown>).category).toBe('nutrition_guidance')
  // No command identifiers: each attempt is a new event, so there is nothing to
  // converge on and nothing to replay.
  expect(read[0]?.headers['idempotency-key']).toBeUndefined()
})

test('a denied attempt is shown as a recorded fact rather than an error', async ({
  context,
  page,
}) => {
  // The screen never offers a read it knows will be refused, so the only way to a
  // denial is the race it cannot prevent: the duty is withdrawn between the answer
  // that offered the read and the click that took it.
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: {
      nextExerciseDenial: 'duty_not_effective',
      files: [openBreakGlassWindow(10, { categories: ['nutrition_guidance'] })],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Leer guía nutricional' }).click()

  const outcome = page.locator('[data-break-glass-outcome]')
  await expect(outcome.getByText('Intento denegado y registrado')).toBeVisible()
  await expect(outcome.getByText(/Tu deber ya no está vigente/)).toBeVisible()
  await expect(outcome.getByText(/Quedó registrado el intento/)).toBeVisible()
  // Denied, and the counter of authorised exercises did not move.
  expect(fixture.breakGlass?.files[0]?.exercise_count).toBe(0)
})

test('a window that lapses on screen stops offering the read by itself', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      // Three seconds, so the countdown runs out while the operator is looking at it.
      breakGlass: { files: [openBreakGlassWindow(0.05, { categories: ['nutrition_guidance'] })] },
    }),
  )

  await page.goto(PATH)
  await expect(page.getByRole('button', { name: 'Leer guía nutricional' })).toBeVisible()

  // No interaction and no reload: the window closes itself, because there is no
  // extension to offer instead.
  await expect(page.getByText(/La ventana ya venció/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leer guía nutricional' })).toHaveCount(0)
  await expect(page.getByText(/Ninguna lectura entrega contenido/)).toBeVisible()
})

test('closing a window is final and leaves nothing to read', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    breakGlass: { files: [openBreakGlassWindow(10, { categories: ['nutrition_guidance'] })] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(PATH)
  await page.getByRole('button', { name: 'Cerrar la ventana' }).click()

  await expect(page.getByText(/Ninguna lectura entrega contenido desde ahora/)).toBeVisible()
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leer guía nutricional' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cerrar la ventana' })).toHaveCount(0)
})

test('a file that is not yours offers no way to exercise it', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: {
        files: [
          openBreakGlassWindow(10, {
            requester_person_id: BREAK_GLASS_PEER_ID,
            categories: ['nutrition_guidance'],
            viewer_is_requester: false,
          }),
        ],
      },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('Ventana abierta')).toBeVisible()
  await expect(page.getByRole('button', { name: /Leer / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cerrar la ventana' })).toHaveCount(0)
})

test('a withdrawn duty is explained as expiry by design, not as an error', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { refusal: { status: 403, code: 'forbidden' }, files: [] },
    }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No se pudo leer la bandeja')).toBeVisible()
  await expect(page.getByText(/Los deberes vencen por diseño/)).toBeVisible()
})

test('an empty tray says what will appear rather than nothing at all', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), breakGlass: { files: [] } }),
  )

  await page.goto(PATH)

  await expect(page.getByText('No hay expedientes')).toBeVisible()
  await expect(page.getByText(/con su quórum, su ventana y cuántas veces se ejerció/)).toBeVisible()
})
