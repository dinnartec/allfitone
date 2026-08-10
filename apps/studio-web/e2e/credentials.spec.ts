import { expect, test } from '@playwright/test'

import {
  createStudioApiFixture,
  error,
  installStudioApiMock,
  professionalCredential,
  professionalProfile,
} from './studio-api-mock'

test('localizes the credential dialog and safely retries a declaration', async ({ page }) => {
  let attempts = 0
  const fixture = createStudioApiFixture({
    me: { profile: { ...professionalProfile, credentials: [] }, memberships: [] },
    intercept: (request) => {
      if (request.method !== 'POST' || request.path !== '/studio/v1/me/professional-credentials') {
        return undefined
      }
      attempts += 1
      return attempts === 1 ? { status: 503, body: error('unavailable') } : undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Credenciales' }).click()

  const trigger = page.getByRole('button', { name: 'Añadir credencial' })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  await trigger.click()
  await chooseCredentialType(page, 'Certificación profesional')
  await page.getByLabel('Emisor').fill('NSCA')
  await page.getByLabel('Nombre').fill('Fuerza aplicada')
  const declare = dialog.getByRole('button', { name: 'Declarar' })
  await declare.click()
  await expect(page.getByText('El servicio no está disponible.', { exact: false })).toBeVisible()
  await declare.click()
  await expect(page.getByText('Credencial declarada como no verificada.')).toBeVisible()

  const writes = fixture.requests.filter(
    (request) =>
      request.method === 'POST' && request.path === '/studio/v1/me/professional-credentials',
  )
  expect(writes).toHaveLength(2)
  expect(writes[1]?.headers['idempotency-key']).toBe(writes[0]?.headers['idempotency-key'])
  expect(writes[1]?.headers['command-id']).toBe(writes[0]?.headers['command-id'])
})

test('revises once, refreshes exact history, and retires the successor', async ({ page }) => {
  const fixture = createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [{ ...professionalCredential }] },
      memberships: [],
    },
    intercept: async (request) => {
      if (request.path.endsWith('/revisions')) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Credenciales' }).click()

  await page.getByRole('button', { name: 'Crear revisión' }).click()
  const revisionDialog = page.getByRole('dialog')
  await expect(
    revisionDialog.getByText(
      'La revisión crea una versión nueva y no hereda la verificación anterior.',
    ),
  ).toBeVisible()
  await revisionDialog.locator('form').evaluate((form) => {
    const credentialForm = form as HTMLFormElement
    credentialForm.requestSubmit()
    credentialForm.requestSubmit()
  })

  await expect(page.getByText('Creamos una nueva versión de la credencial.')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/revisions'),
    ),
  ).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Historial retirado · 1' })).toBeVisible()

  await page.getByRole('button', { name: 'Retirar' }).click()
  const retirementDialog = page.getByRole('alertdialog')
  await retirementDialog.getByRole('button', { name: 'Retirar credencial' }).click()
  await expect(page.getByText('La credencial pasó al historial.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Historial retirado · 2' })).toBeVisible()
})

for (const staleStatus of [404, 409] as const) {
  test(`closes a stale revision after ${staleStatus} and refreshes the professional context`, async ({
    page,
  }) => {
    const fixture = createStudioApiFixture({
      me: {
        profile: { ...professionalProfile, credentials: [{ ...professionalCredential }] },
        memberships: [],
      },
      intercept: (request) =>
        request.path.endsWith('/revisions')
          ? { status: staleStatus, body: error('conflict') }
          : undefined,
    })
    await installStudioApiMock(page, fixture)
    await page.goto('/profile')
    await page.getByRole('tab', { name: 'Credenciales' }).click()
    await page.getByRole('button', { name: 'Crear revisión' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Crear revisión' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByText('La credencial había cambiado. Actualizamos tu perfil.'),
    ).toBeVisible()
    expect(
      fixture.requests.filter(
        (request) => request.method === 'GET' && request.path === '/studio/v1/me',
      ).length,
    ).toBeGreaterThanOrEqual(2)
  })
}

async function chooseCredentialType(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.getByLabel('Tipo').click()
  await page.getByRole('option', { name }).click()
}
