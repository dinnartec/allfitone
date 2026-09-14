import { expect, test, type Page } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  directoryOrganization,
  handoverRecord,
  mockBackofficeApi,
} from './backoffice-api-mock'

const CREATE = '/backoffice/v1/organizations'

async function fillCompany(page: Page) {
  await page.getByLabel('Nombre del gimnasio').fill('Gimnasio Norte')
  await page.getByRole('combobox', { name: 'Tipo' }).click()
  await page.getByRole('option', { name: 'Gimnasio', exact: true }).click()
  await page.getByRole('button', { name: 'Una empresa' }).click()
  await page.getByLabel('Razón social').fill('Norte Fitness SAS')
  await page.getByLabel('Correo de quien será el dueño').fill(' Dueno@Example.test ')
}

test('creates a gym for a company and shows that it waits for its owner', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/organizations/new')
  await expect(page.getByText('Crear no es entregar')).toBeVisible()
  await fillCompany(page)
  await page.getByRole('button', { name: 'Crear y enviar la invitación' }).click()

  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/handover$/)
  await expect(page.getByText('Esperando a su dueño')).toBeVisible()
  await expect(page.getByText(/no opera hasta que su dueño acepte/)).toBeVisible()
  await expect(page.locator('#ho-invited')).toHaveText('d***@example.test')

  const created = fixture.requests.find(
    (request) => request.method === 'POST' && request.path === CREATE,
  )
  expect(created?.body).toEqual({
    display_name: 'Gimnasio Norte',
    type_code: 'gym',
    party_kind: 'legal_entity',
    legal_name: 'Norte Fitness SAS',
    site: null,
    owner_email: 'dueno@example.test',
  })
  expect(created?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(created?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('never asks for the name of a natural person', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/organizations/new')
  await page.getByLabel('Nombre del gimnasio').fill('Estudio de Ana')
  await page.getByRole('combobox', { name: 'Tipo' }).click()
  await page.getByRole('option', { name: 'Estudio', exact: true }).click()
  await page.getByRole('button', { name: 'Una persona natural' }).click()

  await expect(page.getByLabel('Razón social')).toHaveCount(0)
  await expect(page.getByText(/se toma de su propia cuenta cuando acepte/)).toBeVisible()

  await page.getByLabel('Correo de quien será el dueño').fill('ana@example.test')
  await page.getByRole('button', { name: 'Crear y enviar la invitación' }).click()

  await expect(page.getByText('Esperando a su dueño')).toBeVisible()
  const created = fixture.requests.find(
    (request) => request.method === 'POST' && request.path === CREATE,
  )
  expect((created?.body as { legal_name: unknown }).legal_name).toBeNull()
})

test('refuses an incomplete form before it is sent', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/organizations/new')
  await page.getByLabel('Nombre del gimnasio').fill('Gimnasio Norte')
  await page.getByRole('button', { name: 'Crear y enviar la invitación' }).click()

  await expect(page.getByText('Elige qué tipo de organización es.')).toBeVisible()
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
})

test('a retry after a lost answer converges on one gym', async ({ context, page }) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [], nextCreateNetworkFailure: true },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/organizations/new')
  await fillCompany(page)
  await page.getByRole('button', { name: 'Crear y enviar la invitación' }).click()
  await expect(page.getByText('No se pudo crear el gimnasio')).toBeVisible()
  await expect(page.getByText(/no se duplicará nada/)).toBeVisible()

  await page.getByRole('button', { name: 'Crear y enviar la invitación' }).click()
  await expect(page.getByText('Esperando a su dueño')).toBeVisible()

  const attempts = fixture.requests.filter(
    (request) => request.method === 'POST' && request.path === CREATE,
  )
  expect(attempts).toHaveLength(2)
  expect(attempts[1]?.headers['command-id']).toBe(attempts[0]?.headers['command-id'])
  expect(fixture.organizationHandover?.handovers).toHaveLength(1)
})

test('resending a live invitation says the first link still works', async ({ context, page }) => {
  const record = handoverRecord()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization_id}/handover`)
  await page.getByRole('button', { name: 'Enviar la invitación de nuevo' }).click()

  await expect(
    page.getByText(/misma invitación\. El enlace del primer correo sigue sirviendo/),
  ).toBeVisible()
  const resend = fixture.requests.find((request) => request.path.endsWith('/handover/resends'))
  expect(resend?.body ?? null).toBeNull()
})

test('resending a lapsed invitation says a new one went to the same address', async ({
  context,
  page,
}) => {
  const record = handoverRecord({
    invitation: {
      invitation_id: '019a7100-0000-7000-8000-00000000aaaa',
      status: 'expired',
      intent_status: 'expired',
      contact_hint: 'o***@example.test',
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    },
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationHandover: { handovers: [record] },
    }),
  )

  await page.goto(`/organizations/${record.organization_id}/handover`)
  await expect(page.getByText('La invitación venció')).toBeVisible()
  await page.getByRole('button', { name: 'Enviar la invitación de nuevo' }).click()

  await expect(page.getByText('Se envió una invitación nueva a la misma dirección.')).toBeVisible()
  await expect(page.getByText('Esperando a su dueño')).toBeVisible()
})

test('cancelling asks again, then withdraws the invitation for good', async ({ context, page }) => {
  const record = handoverRecord()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization_id}/handover`)
  await page.getByRole('button', { name: 'Cancelar la creación' }).click()
  await expect(page.getByText(/no se puede deshacer/)).toBeVisible()
  expect(fixture.requests.filter((request) => request.path.endsWith('/cancellation'))).toHaveLength(
    0,
  )

  await page.getByRole('button', { name: 'Sí, cancelar la creación' }).click()

  await expect(page.getByText('Cancelado', { exact: true })).toBeVisible()
  await expect(page.getByText(/invitación retirada/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar la invitación de nuevo' })).toHaveCount(0)
  expect(fixture.requests.filter((request) => request.path.endsWith('/cancellation'))).toHaveLength(
    1,
  )
})

test('backing out of cancelling changes nothing', async ({ context, page }) => {
  const record = handoverRecord()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationHandover: { handovers: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization_id}/handover`)
  await page.getByRole('button', { name: 'Cancelar la creación' }).click()
  await page.getByRole('button', { name: 'No, dejarlo como está' }).click()

  await expect(page.getByText('Esperando a su dueño')).toBeVisible()
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
})

test('an owner who accepted meanwhile is read again instead of guessed', async ({
  context,
  page,
}) => {
  const record = handoverRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationHandover: { handovers: [record], nextCommandClaimedElsewhere: true },
    }),
  )

  await page.goto(`/organizations/${record.organization_id}/handover`)
  await page.getByRole('button', { name: 'Enviar la invitación de nuevo' }).click()

  await expect(page.getByText(/ya no espera a su dueño/)).toBeVisible()
  await expect(page.getByText('Entregado', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancelar la creación' })).toHaveCount(0)
})

test('a handover its owner accepted offers nothing to do', async ({ context, page }) => {
  const record = handoverRecord({ status: 'active', claimed_at: new Date().toISOString() })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationHandover: { handovers: [record] },
    }),
  )

  await page.goto(`/organizations/${record.organization_id}/handover`)

  await expect(page.getByText('Entregado', { exact: true })).toBeVisible()
  await expect(page.getByText(/lo administra su dueño en Studio/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar la invitación de nuevo' })).toHaveCount(0)
})

test('a withdrawn lifecycle duty is explained as expiry by design', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationHandover: { refusal: { status: 403, code: 'forbidden' }, handovers: [] },
    }),
  )

  await page.goto('/organizations/019a7000-0000-7000-8000-000000009999/handover')

  await expect(page.getByText('No se pudo leer la entrega')).toBeVisible()
  await expect(page.getByText(/Los deberes vencen por diseño/)).toBeVisible()
})

test('the directory leads to creating a gym and to an unclaimed gym’s handover', async ({
  context,
  page,
}) => {
  const record = handoverRecord({ display_name: 'Gimnasio Nuevo' })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: {
        organizations: [
          directoryOrganization({
            organization_id: record.organization_id,
            display_name: 'Gimnasio Nuevo',
            status: 'unclaimed',
          }),
          directoryOrganization({ display_name: 'Gimnasio Operando', status: 'active' }),
        ],
      },
      organizationHandover: { handovers: [record] },
    }),
  )

  await page.goto('/organizations')
  await expect(page.getByRole('link', { name: 'Crear un gimnasio para una venta' })).toBeVisible()
  // An operating gym opens on its file, never on a handover it does not have.
  await expect(page.getByRole('link', { name: 'Gimnasio Operando' })).toHaveAttribute(
    'href',
    /^\/organizations\/[0-9a-f-]{36}$/,
  )
  await page.getByRole('link', { name: 'Gimnasio Nuevo' }).click()

  await expect(page).toHaveURL(`/organizations/${record.organization_id}/handover`)
  await expect(page.getByText('Esperando a su dueño')).toBeVisible()
})
