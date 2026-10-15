import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  organizationFileRecord,
} from './backoffice-api-mock'

/**
 * `HU-BO-016` — stopping a gym, from the gym's own file.
 *
 * What is asserted is what the screen must make true: that the operator is told what
 * suspending does *not* do before they press it, that the cost is on screen while the
 * reason is being picked, that reactivating is described as subtractive rather than as
 * a restore, and that the record of a lifted suspension survives.
 */

test('the panel says what suspending does not do, not only what it does', async ({
  context,
  page,
}) => {
  const record = organizationFileRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await expect(page.locator('[data-suspension-does]')).toContainText('deja de operar')
  await expect(page.locator('[data-suspension-does]')).toContainText('plan gratuito')
  await expect(page.locator('[data-suspension-does-not]')).toContainText(
    'No termina ninguna relación',
  )
  await expect(page.locator('[data-suspension-does-not]')).toContainText('no borra nada')
  await expect(page.locator('[data-suspension-state]')).toContainText('nunca ha estado suspendido')
})

test('the cost is on screen while the reason is being picked, counted against this gym', async ({
  context,
  page,
}) => {
  const record = organizationFileRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  const cost = page.locator('[data-suspension-cost]')
  await expect(cost).toBeVisible()
  await expect(cost).toContainText('Nadie sale del gimnasio')
})

test('stops a gym and reads back how many people it cost', async ({ context, page }) => {
  const record = organizationFileRecord()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await page.locator('#suspension-reason').click()
  await page.getByRole('option', { name: 'Incumplió los términos', exact: true }).click()
  await page.locator('[data-suspension-save]').click()

  await expect(page.locator('[data-suspension-outcome]')).toContainText(
    'No se terminó ninguna relación',
  )
  await expect(page.locator('[data-suspension-state]')).toContainText('Suspendido')
  await expect(page.locator('[data-suspension-blocked]')).toContainText('dejaron de recibir')

  const commands = fixture.requests.filter(
    (request) =>
      request.method === 'POST' &&
      request.path ===
        `/backoffice/v1/organizations/${record.organization.organization_id}/suspension`,
  )
  expect(commands).toHaveLength(1)
  expect(commands[0]?.body).toEqual({ reason_code: 'terms_breach' })
  expect(commands[0]?.headers['idempotency-key']).toBeTruthy()
})

test('reactivating is offered as subtractive, never as a restore', async ({ context, page }) => {
  const record = organizationFileRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), organizationFiles: { files: [record] } }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)
  await page.locator('[data-suspension-save]').click()
  await expect(page.locator('[data-suspension-state]')).toContainText('Suspendido')

  const note = page.locator('[data-suspension-reactivate-note]')
  await expect(note).toContainText('No restaura una copia anterior')
  await expect(note).toContainText('no revive')
  await expect(note).toContainText('sigue aplicando')
  await expect(note).not.toContainText('restaurar todo')

  await page.locator('[data-suspension-reactivate]').click()

  await expect(page.locator('[data-suspension-outcome]')).toContainText('vuelve a operar')
  // Criterion 8: the record outlives the state.
  await expect(page.locator('[data-suspension-period]').first()).toContainText('levantada')
  await expect(page.locator('[data-suspension-state]')).toContainText('Estuvo suspendido antes')
})

test('without the lifecycle duty the panel says which duty it needs', async ({ context, page }) => {
  const record = organizationFileRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: {
        files: [record],
        suspensionRefusal: { status: 403, code: 'forbidden' },
      },
    }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)
  await page.locator('[data-suspension-save]').click()

  await expect(page.locator('[data-suspension-failure]')).toContainText(
    'manage_organization_lifecycle',
  )
  // The file itself is still open: a refused command is not a refused read.
  await expect(page.getByRole('heading', { name: record.organization.display_name })).toBeVisible()
})

test('a gym that does not qualify is told which states do', async ({ context, page }) => {
  const record = organizationFileRecord()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: {
        files: [record],
        suspensionRefusal: { status: 409, code: 'conflict' },
      },
    }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)
  await page.locator('[data-suspension-save]').click()

  await expect(page.locator('[data-suspension-failure]')).toContainText(
    'sin reclamar, cancelado o cerrado',
  )
})
