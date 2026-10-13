import { expect, test } from '@playwright/test'

import {
  activeMembership,
  activeSubscription,
  createStudioApiFixture,
  installStudioApiMock,
  organizationRoleCatalog,
} from './studio-api-mock'

function open(page: import('@playwright/test').Page, organizationId: string) {
  return page.goto(`/organizations/${organizationId}/billing`)
}

/** The same catalogue with `manage_billing` taken off whatever role the caller holds. */
function withoutBilling() {
  return organizationRoleCatalog.map((role) =>
    typeof role === 'object' && role !== null && 'capabilities' in role
      ? {
          ...role,
          capabilities: (role.capabilities as Array<{ code: string }>).filter(
            (capability) => capability.code !== 'manage_billing',
          ),
        }
      : role,
  )
}

test('an owner reads who pays and what each one pays', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  const row = page.locator('[data-billing-row]')
  await expect(row).toContainText('Ana Álvarez')
  await expect(row).toContainText('Mensual')
  await expect(row).toContainText('Al día')
  /*
   * The assertion that stops a $120.000 plan reading as $12.000.000 on the screen where
   * somebody decides whether to suspend it. The API sends the minor unit.
   */
  await expect(row).toContainText('120.000')
  await expect(row).not.toContainText('12.000.000')
  // Null until the gateway reports a charge, and a dash would read as "today".
  await expect(row).toContainText('Sin cobro reportado')
})

test('the screen says Allfit never holds the card', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.locator('[data-billing-page]')).toContainText('nunca guarda datos de tarjeta')
})

test('pausing a plan moves it and never offers to pause it twice', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await page.locator('[data-billing-action="suspend"]').click()
  await page.getByRole('button', { name: 'Pausar y avisar' }).click()

  await expect(page.locator('[data-billing-row]')).toContainText('En pausa')
  await expect(page.getByRole('dialog')).toBeHidden()
  // A paused plan takes reactivate or end; pausing again would be a 409.
  await expect(page.locator('[data-billing-action="suspend"]')).toBeHidden()
  await expect(page.locator('[data-billing-action="reactivate"]')).toBeVisible()

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/suspension'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

/*
 * The confirmation's reason to exist. An administrator pausing somebody for non-payment
 * will reasonably fear that it takes the client's data away, and will either avoid the
 * action or use it believing it does something the platform deliberately does not do.
 */
test('the confirmation denies the permission fear and warns about the email', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.locator('[data-billing-action="suspend"]').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('No se le quita ningún permiso')
  await expect(dialog).toContainText('el vínculo con la organización sigue igual')
  await expect(dialog).toContainText('sin que la persona tenga que aceptar nada de nuevo')
  await expect(dialog).toContainText('avisar por correo')
})

test('ending a plan says it does not end the vínculo, and leaves no action behind', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await page.locator('[data-billing-action="end"]').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('no termina el vínculo')
  await expect(dialog).toContainText('ni retira los permisos')
  await page.getByRole('button', { name: 'Terminar y avisar' }).click()

  await expect(page.locator('[data-billing-row]')).toContainText('Terminada')
  // An ended subscription takes nothing. A disabled button would only invite the reader
  // to look for a reason that does not exist.
  await expect(page.locator('[data-billing-actions]')).toBeHidden()
})

test('a reactivation with no open cause is not described as something to retry', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationSubscriptions: [{ ...activeSubscription, status: 'suspended' }],
    subscriptionOutcome: 'no-cause',
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await page.locator('[data-billing-action="reactivate"]').click()
  await page.getByRole('button', { name: 'Reactivar y avisar' }).click()

  const failure = page.locator('[data-billing-error]')
  await expect(failure).toContainText('no tiene una causa abierta que cerrar')
  await expect(failure).toContainText('no un reintento')
})

test('filtering by state asks the server for that state', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationSubscriptions: [
      activeSubscription,
      {
        ...activeSubscription,
        subscription_id: '01991600-7000-7000-8000-000000000602',
        person_name: 'Bruno Bedoya',
        status: 'suspended',
        suspended_at: '2026-10-18T09:00:00.000Z',
      },
    ],
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.locator('[data-billing-row]')).toHaveCount(2)
  await page.getByRole('button', { name: 'En pausa' }).click()

  await expect(page.locator('[data-billing-row]')).toHaveCount(1)
  await expect(page.locator('[data-billing-row]')).toContainText('Bruno Bedoya')
  const filtered = fixture.requests.find(
    (request) => request.method === 'GET' && request.search.includes('status=suspended'),
  )
  expect(filtered).toBeDefined()
})

/*
 * A coach with that client assigned reads the same answer as a stranger. The payment state
 * of a person is not a training fact, and the screen says why rather than only refusing.
 */
test('a role without manage_billing is told why, and asks for nothing', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationRoles: withoutBilling(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.getByText('No tienes acceso a los cobros')).toBeVisible()
  await expect(page.locator('[data-billing-page]')).toContainText('no es un dato de entrenamiento')
  expect(
    fixture.requests.filter(
      (request) => request.method === 'GET' && request.path.endsWith('/subscriptions'),
    ),
  ).toHaveLength(0)
})

test('an empty list says where a subscription comes from, because it is not from here', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationSubscriptions: [],
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.locator('[data-billing-page]')).toContainText('Todavía nadie paga aquí')
  await expect(page.locator('[data-billing-page]')).toContainText(
    'Las personas se suscriben desde la app',
  )
})

test('the sidebar reaches the screen and the header names it', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await page.getByRole('link', { name: 'Cobros' }).click()

  await expect(page).toHaveURL(
    new RegExp(`/organizations/${activeMembership.organization_id}/billing$`),
  )
  await expect(page.getByRole('heading', { name: 'Cobros' })).toBeVisible()
})
