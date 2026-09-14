import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  directoryOrganization,
  mockBackofficeApi,
  organizationFileRecord,
} from './backoffice-api-mock'

const OWNER = '019a9100-0000-7000-8000-000000000006'
const COACH = '019a9100-0000-7000-8000-000000000008'
const ADMIN = '019a9100-0000-7000-8000-000000000009'

function norte() {
  return organizationFileRecord({
    owner: {
      person_id: OWNER,
      membership_id: '019a9100-0000-7000-8000-000000000311',
      since: '2026-06-01T12:00:00.000Z',
    },
    team: [
      {
        membership_id: '019a9100-0000-7000-8000-000000000311',
        person_id: OWNER,
        roles: ['owner'],
        joined_at: '2026-06-01T12:00:00.000Z',
      },
      {
        membership_id: '019a9100-0000-7000-8000-000000000312',
        person_id: COACH,
        roles: ['coach'],
        joined_at: '2026-07-01T12:00:00.000Z',
      },
      {
        membership_id: '019a9100-0000-7000-8000-000000000313',
        person_id: ADMIN,
        roles: ['admin'],
        joined_at: '2026-08-01T12:00:00.000Z',
      },
    ],
    team_counts: { active: 3, terminated: 1 },
    sites: [
      {
        site_id: '019a9100-0000-7000-8000-000000000401',
        name: 'Sede Calle 80',
        address: 'Calle 80 # 1-10',
        address_withheld: false,
        status: 'active',
      },
    ],
  })
}

test('opens a gym’s file with its data, owner, team and sites, and no names', async ({
  context,
  page,
}) => {
  const record = norte()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await expect(page.getByRole('heading', { name: record.organization.display_name })).toBeVisible()
  await expect(page.getByText('Norte Fitness SAS')).toBeVisible()
  await expect(page.locator('[data-file-owner]').getByText(OWNER)).toBeVisible()
  await expect(page.locator('[data-file-member]')).toHaveCount(3)
  await expect(page.getByRole('cell', { name: 'Coach', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Administrador', exact: true })).toBeVisible()
  await expect(page.getByText('3 personas activas, y 1 que ya no está.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Calle 80 # 1-10' })).toBeVisible()
  await expect(page.getByText(/Sus planes publicados y sus suscriptores/)).toBeVisible()
  await expect(page.getByText(/es que Allfit aún no los guarda/)).toBeVisible()

  const reads = fixture.requests.filter(
    (request) =>
      request.path === `/backoffice/v1/organizations/${record.organization.organization_id}`,
  )
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.every((request) => request.query === '')).toBe(true)
})

test('opens a person’s card only once a traceable case reference is written', async ({
  context,
  page,
}) => {
  const record = norte()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)
  await expect(page.locator('[data-file-member]')).toHaveCount(3)
  await expect(page.locator('[data-file-member-link]')).toHaveCount(0)

  await page.getByLabel('Referencia de caso para abrir una persona').fill('no es un caso')
  await expect(page.locator('[data-file-member-link]')).toHaveCount(0)

  await page.getByLabel('Referencia de caso para abrir una persona').fill('CASE-2026-013')
  // The owner is linked in its own field and in the team list.
  await expect(page.locator('[data-file-member-link]')).toHaveCount(4)
  await expect(page.locator('[data-file-member] [data-file-member-link]').first()).toHaveAttribute(
    'href',
    `/people/${OWNER}?case_reference=CASE-2026-013`,
  )
})

test('an independent professional’s name and home address stay out of the file', async ({
  context,
  page,
}) => {
  const record = organizationFileRecord({
    organization: {
      ...organizationFileRecord().organization,
      display_name: 'Consultorio Solo',
      type_code: 'professional_practice',
      type_name: 'Práctica profesional',
      party_kind: 'natural_person',
      legal_name: null,
    },
    sites: [
      {
        site_id: '019a9100-0000-7000-8000-000000000402',
        name: 'Consultorio',
        address: null,
        address_withheld: true,
        status: 'active',
      },
    ],
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await expect(page.getByText(/Una persona natural\. Su nombre no se muestra aquí/)).toBeVisible()
  await expect(page.getByText(/Reservada: puede ser la casa de quien atiende/)).toBeVisible()
})

test('a gym nobody claimed shows no owner and leads to its handover', async ({ context, page }) => {
  const base = organizationFileRecord()
  const record = organizationFileRecord({
    organization: { ...base.organization, status: 'unclaimed', claimed_at: null },
    owner: null,
    team: [],
    team_counts: { active: 0, terminated: 0 },
  })
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await expect(page.getByText('Sin dueño: nadie ha reclamado el gimnasio.')).toBeVisible()
  await expect(page.getByText(/nunca tuvo dueño/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver la entrega a su dueño' })).toHaveAttribute(
    'href',
    `/organizations/${record.organization.organization_id}/handover`,
  )
})

test('a withdrawn duty is explained as expiry by design', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { refusal: { status: 403, code: 'forbidden' }, files: [] },
    }),
  )

  await page.goto('/organizations/019a9100-0000-7000-8000-000000009999')

  await expect(page.getByText('No se pudo abrir la ficha')).toBeVisible()
  await expect(page.getByText(/Los deberes vencen por diseño/)).toBeVisible()
})

test('an unknown gym says it does not exist', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [] } }),
  )

  await page.goto('/organizations/019a9100-0000-7000-8000-000000009998')

  await expect(page.getByText('Ese gimnasio no existe.')).toBeVisible()
})

test('the directory opens an operating gym’s file', async ({ context, page }) => {
  const record = norte()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationDirectory: {
        organizations: [
          directoryOrganization({
            organization_id: record.organization.organization_id,
            display_name: record.organization.display_name,
            status: 'active',
          }),
        ],
      },
      organizationFiles: { files: [record] },
    }),
  )

  await page.goto('/organizations')
  await page.getByRole('link', { name: record.organization.display_name }).click()

  await expect(page).toHaveURL(`/organizations/${record.organization.organization_id}`)
  await expect(page.locator('[data-file-member]')).toHaveCount(3)
})
