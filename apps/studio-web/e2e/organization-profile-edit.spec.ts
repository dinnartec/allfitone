import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  organizationWithSites,
  professionalPracticeOrganization,
  secondActiveMembership,
} from './studio-api-mock'

const organizationPath = `/organizations/${activeMembership.organization_id}/organization`
const editPath = `${organizationPath}/edit`

test('renames the organization and the card shows the new name', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(organizationPath)

  await page.getByRole('link', { name: 'Editar datos' }).click()
  await expect(page).toHaveURL(new RegExp(`${editPath}$`))
  // The page says where you are. Unregistered, this route fell through to the
  // workspace's "Studio" fallback: one heading, naming the product.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Editar datos')
  await expect(page.getByLabel('Nombre')).toHaveValue(organizationWithSites.display_name)

  await page.getByLabel('Nombre').fill('Allfit Gym Norte')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  await expect(page.getByText('Allfit Gym Norte')).toBeVisible()

  // Only the field that moved, carrying the revision the screen was on, and no
  // `If-Match`: the Edge answers a conditional write before the function runs.
  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({
    display_name: 'Allfit Gym Norte',
    expected_revision: organizationWithSites.revision_number,
  })
  expect(saved?.headers['if-match']).toBeUndefined()
})

test('clearing the legal name sends null rather than an empty string', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByLabel('Razón social').fill('')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({
    legal_name: null,
    expected_revision: organizationWithSites.revision_number,
  })
})

test('with nothing changed there is nothing to save', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()

  await page.getByLabel('Nombre').fill('Otro nombre')
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()

  await page.getByLabel('Nombre').fill(organizationWithSites.display_name)
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  expect(fixture.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(0)
})

/**
 * Criterion 2, the half the screen can answer before anyone clicks: a gym has no
 * transition out, so the type is a value to read rather than a control that can
 * only refuse.
 */
test('a gym is told its type is settled, instead of being offered a choice', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await expect(page.getByText('Gimnasio')).toBeVisible()
  await expect(page.getByText('El tipo ya no se puede cambiar desde aquí')).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
})

/**
 * Criterion 2, the other half. A professional practice may become a gym or a
 * studio, and nothing else — so those are the only two the list offers, and it
 * never offers the way back.
 */
test('a professional practice is offered only the two moves the server accepts', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organization: structuredClone(professionalPracticeOrganization),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByRole('combobox').click()
  const options = page.getByRole('option')
  await expect(options).toHaveText(['Profesional independiente', 'Gimnasio', 'Estudio'])

  await page.getByRole('option', { name: 'Estudio' }).click()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({
    type_code: 'studio',
    expected_revision: professionalPracticeOrganization.revision_number,
  })
})

/**
 * The backstop for criterion 2. The list cannot offer this move, so the only way
 * to reach the refusal is to send it anyway — which is what a stale screen does
 * after someone else changes the type. The screen has to say which change was
 * refused, not just that something failed.
 */
test('a type change the server refuses is explained, not swallowed', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organization: structuredClone(professionalPracticeOrganization),
    intercept: (request) => {
      if (request.method === 'PATCH') {
        // The organization became a gym elsewhere, so the move this screen is
        // sending is no longer one the transition table lists.
        return {
          status: 422,
          body: { type: 'about:blank', title: 'validation-failed', status: 422 },
        }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Gimnasio' }).click()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page.getByText('Ese cambio de tipo no está permitido')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${editPath}$`))
})

/**
 * Criterion 4. Two people editing the same organization: the save carries the
 * revision the screen was showing, the server compares it with the row it holds,
 * and refuses rather than letting the second write erase the first.
 *
 * The wording is the point. Retrying with the same stale copy would overwrite
 * the other edit, so the only honest instruction is to look again.
 */
test('an organization someone else saved first is refused, not overwritten', async ({ page }) => {
  let elsewhere = true
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request, fixture) => {
      if (elsewhere && request.method === 'PATCH') {
        elsewhere = false
        // Someone else's save lands between this screen loading and its save.
        const organization = fixture.organization as { revision_number: number }
        organization.revision_number += 1
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByLabel('Nombre').fill('Allfit Gym Sur')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page.getByText('Alguien más cambió estos datos mientras los editabas')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${editPath}$`))
})

test('a name is required: an empty one is refused before it travels', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByLabel('Nombre').fill('   ')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page.getByText('Escribe el nombre de la organización.')).toBeVisible()
  expect(fixture.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(0)
})

test('a role that does not manage the organization cannot reach the screen', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [secondActiveMembership] }),
  )
  const coachOrganization = `/organizations/${secondActiveMembership.organization_id}/organization`

  await page.goto(coachOrganization)
  await expect(page.getByRole('link', { name: 'Editar datos' })).toHaveCount(0)

  await page.goto(`${coachOrganization}/edit`)
  await expect(page.getByText('Tu rol no administra la organización')).toBeVisible()
  await expect(page.getByLabel('Nombre')).toHaveCount(0)
})
