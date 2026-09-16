import { expect, test, type Page } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  platformPlan,
  platformPlanVersion,
  platformPlansFixture,
  type PlatformPlansFixture,
} from './backoffice-api-mock'

const HISTORY_WEEKS = { code: 'history_weeks', name: 'Semanas de historial', unit: 'weeks' }
const MEAL_LOGS = { code: 'meal_logs_per_day', name: 'Comidas por día', unit: 'items' }

function fixtureWith(platformPlans: PlatformPlansFixture) {
  return createBackofficeFixture({ session: activeSession(), platformPlans })
}

function commands(fixture: ReturnType<typeof fixtureWith>, suffix = '') {
  return fixture.requests.filter(
    (request) =>
      request.method === 'POST' &&
      request.path.startsWith('/backoffice/v1/platform-plans') &&
      request.path.endsWith(suffix),
  )
}

async function choose(
  page: Page,
  scope: ReturnType<Page['locator']>,
  label: string,
  option: string,
) {
  await scope.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('a plan is created and proposed with no functions to limit, and waits for somebody else', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(platformPlansFixture())
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  await expect(page.locator('[data-plans-features-empty]')).toContainText(
    'qué incluye cada plan no está decidido',
  )

  const create = page.locator('[data-plans-create]')
  await create.getByLabel('Código').fill('premium')
  await create.getByLabel('Nombre').fill('Premium')
  await choose(page, create, 'Tipo', 'De pago')
  await create.getByRole('button', { name: 'Crear plan' }).click()

  await expect(page.locator('[data-plans-outcome]')).toContainText('la publica otra persona')
  const card = page.locator('[data-plan="premium"]')
  await expect(card.locator('[data-plan-in-force]')).toContainText('Nada todavía')
  expect(commands(fixture)[0]?.body).toEqual({
    code: 'premium',
    name: 'Premium',
    plan_kind: 'paid',
  })

  await card.getByLabel('Precio').fill('39900')
  await choose(page, card, 'Cobro', 'Mensual')
  await expect(card.locator('[data-plan-no-features]')).toBeVisible()
  await card.getByRole('button', { name: 'Proponer versión' }).click()

  const proposal = card.locator('[data-plan-proposal]')
  await expect(proposal.locator('[data-plan-review-note]')).toContainText('la publica otra persona')
  await expect(proposal.getByRole('button', { name: 'Publicar versión 1' })).toBeDisabled()
  await expect(proposal.locator('[data-plan-changes]')).toContainText('Primera versión del plan')
  expect(commands(fixture, '/versions')[0]?.body).toEqual({
    amount_minor: 3990000,
    currency_code: 'COP',
    billing_period: 'month',
    features: [],
  })
})

test('a reviewer reads what changes, publishes it, and the replaced version stays in the history', async ({
  context,
  page,
}) => {
  const inForce = platformPlanVersion({
    features: [{ feature_code: 'history_weeks', enabled: true, limit_value: 12 }],
  })
  const proposal = platformPlanVersion({
    version_number: 2,
    status: 'draft',
    amount_minor: 4490000,
    features: [{ feature_code: 'history_weeks', enabled: true, limit_value: 24 }],
    supersedes_version_id: inForce.id,
    changes: [
      { field: 'amount_minor', feature_code: null, before: 3990000, after: 4490000 },
      {
        field: 'feature',
        feature_code: 'history_weeks',
        before: { enabled: true, limit_value: 12 },
        after: { enabled: true, limit_value: 24 },
      },
    ],
    published_by_person_id: null,
    published_at: null,
  })
  const fixture = fixtureWith(
    platformPlansFixture({
      features: [HISTORY_WEEKS],
      plans: [platformPlan({ status: 'published', versions: [inForce, proposal] })],
    }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  const changes = card.locator('[data-plan-changes] li')
  await expect(changes).toHaveCount(2)
  await expect(changes.nth(0)).toContainText('Precio:')
  await expect(changes.nth(1)).toHaveText(
    'Semanas de historial: Hasta 12 semanas → Hasta 24 semanas',
  )
  await expect(card.locator('[data-plan-review-note]')).toContainText('La propuso otra persona')

  await card.getByRole('button', { name: 'Publicar versión 2' }).click()

  await expect(page.locator('[data-plans-outcome]')).toContainText('conserva la suya')
  await expect(card.locator('[data-plan-in-force] [data-plan-version="2"]')).toBeVisible()
  await expect(card.locator('[data-plan-in-force]')).toContainText('Hasta 24 semanas')
  const history = card.locator('[data-plan-history-version="1"]')
  await expect(history).toContainText('Reemplazada')
  await expect(card.locator('[data-plan-proposal]')).toHaveCount(0)
  expect(commands(fixture, '/publication')[0]?.body).toEqual({})
})

test('withdrawing a proposal keeps it in the history and opens the form again', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(
    platformPlansFixture({
      plans: [
        platformPlan({
          versions: [
            platformPlanVersion({
              status: 'draft',
              proposed_by_self: true,
              published_by_person_id: null,
              published_at: null,
            }),
          ],
        }),
      ],
    }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  await card.getByRole('button', { name: 'Retirar propuesta' }).click()

  await expect(page.locator('[data-plans-outcome]')).toContainText('Queda en el historial')
  await expect(card.locator('[data-plan-history-version="1"]')).toContainText('Retirada')
  await expect(card.locator('[data-plan-propose-form]')).toBeVisible()
  expect(commands(fixture, '/withdrawal')).toHaveLength(1)
})

test('a price written with a thousands dot is refused before it is sent', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(platformPlansFixture({ plans: [platformPlan()] }))
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  await card.getByLabel('Precio').fill('39.900')
  await choose(page, card, 'Cobro', 'Mensual')
  await card.getByRole('button', { name: 'Proponer versión' }).click()

  await expect(card.getByText('sin puntos de miles', { exact: false }).last()).toBeVisible()
  expect(commands(fixture, '/versions')).toHaveLength(0)
})

test('the free plan is created once, costs nothing, and its limits are what a version changes', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(
    platformPlansFixture({
      features: [MEAL_LOGS],
      plans: [platformPlan({ code: 'free', name: 'Gratis', plan_kind: 'free' })],
    }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const create = page.locator('[data-plans-create]')
  await create.getByRole('combobox', { name: 'Tipo' }).click()
  // Wait for the list to be open, or an absent option proves nothing.
  await expect(page.getByRole('option', { name: 'De pago', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Gratis', exact: true })).toHaveCount(0)
  // Choosing the only kind left closes the list.
  await page.getByRole('option', { name: 'De pago', exact: true }).click()

  const card = page.locator('[data-plan="free"]')
  await expect(card.locator('[data-plan-free-note]')).toBeVisible()
  await expect(card.getByLabel('Precio')).toHaveCount(0)

  await card.getByRole('checkbox', { name: 'Incluir Comidas por día' }).click()
  await card.getByLabel('Límite de Comidas por día').fill('1')
  await card.getByRole('button', { name: 'Proponer versión' }).click()

  await expect(card.locator('[data-plan-proposal]')).toBeVisible()
  expect(commands(fixture, '/versions')[0]?.body).toEqual({
    amount_minor: 0,
    currency_code: null,
    billing_period: null,
    features: [{ feature_code: 'meal_logs_per_day', enabled: true, limit_value: 1 }],
  })
})

test('a limit that is not a whole number is refused before it is sent', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(
    platformPlansFixture({ features: [MEAL_LOGS], plans: [platformPlan()] }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  await card.getByLabel('Precio').fill('39900')
  await choose(page, card, 'Cobro', 'Anual')
  await card.getByRole('checkbox', { name: 'Incluir Comidas por día' }).click()
  await card.getByLabel('Límite de Comidas por día').fill('2,5')
  await card.getByRole('button', { name: 'Proponer versión' }).click()

  await expect(card.getByText('debe ser un número entero', { exact: false })).toBeVisible()
  expect(commands(fixture, '/versions')).toHaveLength(0)
})

test('without the commercial duty the screen says which duty it needs', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    fixtureWith(platformPlansFixture({ refusal: { status: 403, code: 'forbidden' } })),
  )

  await page.goto('/plans')

  await expect(page.locator('[data-plans-failure]')).toContainText('manage_platform_commercial')
  await expect(page.locator('[data-plans-create]')).toHaveCount(0)
})

test('a proposal lost to the network is retried with the same command', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(platformPlansFixture({ lostCommands: 1, plans: [platformPlan()] }))
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  await card.getByLabel('Precio').fill('39900')
  await choose(page, card, 'Cobro', 'Mensual')
  const propose = card.getByRole('button', { name: 'Proponer versión' })

  await propose.click()
  await expect(page.locator('[data-plans-command-failure]')).toContainText(
    'No hay conexión con el API.',
  )
  await propose.click()
  await expect(card.locator('[data-plan-proposal]')).toBeVisible()

  const attempts = commands(fixture, '/versions')
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['idempotency-key']).toBe(attempts[0]?.headers['idempotency-key'])
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
})

test('a proposal that meets another one open is explained, not retried', async ({
  context,
  page,
}) => {
  const fixture = fixtureWith(
    platformPlansFixture({
      commandRefusal: { status: 409, code: 'conflict' },
      plans: [platformPlan()],
    }),
  )
  await mockBackofficeApi(context, fixture)

  await page.goto('/plans')

  const card = page.locator('[data-plan="premium"]')
  await card.getByLabel('Precio').fill('39900')
  await choose(page, card, 'Cobro', 'Mensual')
  await card.getByRole('button', { name: 'Proponer versión' }).click()

  await expect(page.locator('[data-plans-command-failure]')).toContainText(
    'ya tiene una propuesta abierta',
  )
})
