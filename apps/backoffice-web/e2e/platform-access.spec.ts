import { expect, test } from '@playwright/test'

import {
  ACTOR_PERSON_ID,
  SUBJECT_PERSON_ID,
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  platformDuty,
  platformRole,
} from './backoffice-api-mock'

const NEW_PERSON_ID = '019a3000-0000-7000-8000-0000000000ff'

function seeded() {
  return {
    roles: [
      platformRole({ person_id: ACTOR_PERSON_ID, granted_by_person_id: SUBJECT_PERSON_ID }),
      platformRole({ person_id: SUBJECT_PERSON_ID }),
    ],
    duties: [
      platformDuty({ person_id: ACTOR_PERSON_ID, duty_code: 'manage_platform_access' }),
      platformDuty({ person_id: SUBJECT_PERSON_ID, duty_code: 'diagnose_support_metadata' }),
    ],
  }
}

test('shows who reaches the data, with the state and window of every duty', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), platformAccess: seeded() }),
  )

  await page.goto('/team')

  await expect(page.getByRole('heading', { name: 'Rol base' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Deberes de plataforma' })).toBeVisible()
  // Scoped to the table: the duty the grant form has selected carries the same name in
  // its closed selector, so a loose text match finds two.
  await expect(page.getByRole('cell', { name: 'Administrar accesos de plataforma' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Diagnosticar metadatos de soporte' })).toBeVisible()
  // The duty carries its mode and its required assurance, not just its name.
  await expect(page.getByRole('cell', { name: 'A12', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '2', exact: true }).first()).toBeVisible()
})

test('refuses the inventory without a reading duty and says why', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      platformAccess: { ...seeded(), forbidden: true },
    }),
  )

  await page.goto('/team')

  await expect(page.getByText('No puedes ver este inventario')).toBeVisible()
  await expect(page.getByText(/deber vigente de administración o de auditoría/)).toBeVisible()
})

test('grants a base role and then a duty for it', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    platformAccess: seeded(),
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Rol base' })).toBeVisible()

  await page.getByLabel('Persona que recibe el rol').fill(NEW_PERSON_ID)
  await page.getByRole('button', { name: 'Otorgar rol base' }).click()
  await expect(page.getByText('Rol base otorgado.')).toBeVisible()

  await page.getByLabel('Persona que recibe el deber').fill(NEW_PERSON_ID)
  await page.getByLabel('Referencia', { exact: true }).fill('CASE-2026-014')
  await page.getByRole('button', { name: 'Otorgar deber' }).click()
  await expect(page.getByText('Deber otorgado.')).toBeVisible()

  const grant = fixture.requests.find(
    (request) =>
      request.method === 'POST' && request.path === '/backoffice/v1/platform/duty-assignments',
  )
  expect(grant?.headers['idempotency-key']).toBeTruthy()
  expect(grant?.headers['command-id']).toBeTruthy()
  // The window travels as an instant the server bounds, never as a raw duration.
  expect((grant?.body as { valid_to?: string })?.valid_to).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect((grant?.body as { reason_code?: string })?.reason_code).toBe('CASE-2026-014')
})

test('refuses a proposed window longer than the rules allow before sending it', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    platformAccess: seeded(),
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/team')
  await page.getByLabel('Persona que recibe el deber').fill(NEW_PERSON_ID)
  await page.getByLabel('Vigencia en días', { exact: true }).fill('120')
  await page.getByLabel('Referencia', { exact: true }).fill('CASE-2026-015')
  await page.getByRole('button', { name: 'Otorgar deber' }).click()

  await expect(page.getByText('La vigencia va de 1 a 90 días.')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) =>
        request.method === 'POST' && request.path === '/backoffice/v1/platform/duty-assignments',
    ),
  ).toHaveLength(0)
})

test('withdrawing the base role closes the duties it carried', async ({ context, page }) => {
  const access = seeded()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), platformAccess: access }),
  )

  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Rol base' })).toBeVisible()

  await page
    .getByRole('row')
    .filter({ hasText: SUBJECT_PERSON_ID })
    .first()
    .getByRole('button', { name: 'Retirar' })
    .click()

  await expect(page.getByText(/Rol base retirado/)).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: SUBJECT_PERSON_ID }).first()).toContainText(
    'Retirado',
  )
  // The duty the person carried is now revoked, not silently missing.
  await expect(page.getByRole('cell', { name: 'Revocado' }).first()).toBeVisible()
})

test('explains a refused command as an expired duty rather than a bad request', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      platformAccess: {
        ...seeded(),
        nextCommandFailure: { status: 403, code: 'forbidden' },
      },
    }),
  )

  await page.goto('/team')
  await page.getByLabel('Persona que recibe el rol').fill(NEW_PERSON_ID)
  await page.getByRole('button', { name: 'Otorgar rol base' }).click()

  await expect(page.getByText(/no tiene un deber vigente/)).toBeVisible()
})

test('sends an unauthenticated operator back to the access screen', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture({ platformAccess: seeded() }))

  await page.goto('/team')

  await expect(page.getByRole('heading', { name: 'Identifica tu acceso.' })).toBeVisible()
})

test('reaches the whole inventory instead of showing the first page as if it were all', async ({
  context,
  page,
}) => {
  const roles = Array.from({ length: 5 }, (_, index) =>
    platformRole({ person_id: `019a3000-0000-7000-8000-00000000010${index}` }),
  )
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      platformAccess: { roles, duties: [], pageSize: 2 },
    }),
  )

  await page.goto('/team')

  const rows = page.getByRole('row').filter({ hasText: '019a3000-0000-7000-8000-0000000001' })
  await expect(rows).toHaveCount(2)

  const more = page.getByRole('button', { name: 'Ver más asignaciones de rol base' })
  await expect(more).toBeVisible()
  await more.click()
  await expect(rows).toHaveCount(4)

  await more.click()
  await expect(rows).toHaveCount(5)
  // Nothing left to fetch, so the invitation to fetch disappears.
  await expect(more).toBeHidden()
})
