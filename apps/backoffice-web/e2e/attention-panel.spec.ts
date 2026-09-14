import { expect, test } from '@playwright/test'

import {
  activeSession,
  attentionPanelRecord,
  createBackofficeFixture,
  directoryOrganization,
  mockBackofficeApi,
} from './backoffice-api-mock'

test('a verifier sees the credentials waiting, and no notice its duties do not resolve', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      attention: {
        panel: attentionPanelRecord({
          credential_verifications: {
            availability: 'available',
            pending_count: 2,
            oldest_requested_at: '2026-09-01T12:00:00.000Z',
            renewals_due_count: 1,
          },
          unclaimed_organizations: {
            availability: 'withheld',
            count: null,
            oldest_created_at: null,
            needs_follow_up_count: null,
          },
          repeated_failures: {
            availability: 'withheld',
            window_hours: 24,
            groups: null,
            groups_truncated: null,
            open_circuits: null,
          },
        }),
      },
    }),
  )

  await page.goto('/panel')

  const verifications = page.locator('[data-attention-notice="verifications"]')
  await expect(
    verifications.getByText(
      '2 títulos esperan revisión, y 1 verificación vence en menos de 30 días sin renovación abierta.',
    ),
  ).toBeVisible()
  await expect(verifications.getByText('Pendiente', { exact: true })).toBeVisible()
  await expect(verifications.getByRole('link', { name: 'Ir a verificar títulos' })).toHaveAttribute(
    'href',
    '/verifications',
  )

  for (const kind of ['unclaimed', 'failures']) {
    const notice = page.locator(`[data-attention-notice="${kind}"]`)
    await expect(notice).toHaveAttribute('data-availability', 'withheld')
    await expect(notice.getByText('No es de tus deberes')).toBeVisible()
    await expect(notice.getByText(/No significa que no haya nada pendiente/)).toBeVisible()
    await expect(notice.locator('[data-attention-link]')).toHaveCount(0)
  }

  await expect(
    page.locator('[data-attention-notice="billing"]').getByText(/Allfit todavía no guarda cobros/),
  ).toBeVisible()
})

test('support follows a notice to the gyms nobody claimed, already filtered', async ({
  context,
  page,
}) => {
  const fixture = createBackofficeFixture({
    session: activeSession(),
    attention: { panel: attentionPanelRecord() },
    organizationDirectory: {
      organizations: [
        directoryOrganization({ display_name: 'Norte Sin Dueño', status: 'unclaimed' }),
        directoryOrganization({ display_name: 'Sur Operando', status: 'active' }),
      ],
    },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto('/panel')

  const failures = page.locator('[data-attention-notice="failures"]')
  await expect(failures.locator('[data-attention-failure]')).toHaveCount(1)
  await expect(
    failures.locator('[data-attention-failure]').getByText('5 fallas en 2 avisos'),
  ).toBeVisible()
  await expect(failures.locator('[data-attention-circuits]')).toContainText(
    'identity.invitation_issued.v1',
  )
  await expect(failures.getByRole('link', { name: 'Ir al diagnóstico técnico' })).toHaveAttribute(
    'href',
    '/diagnosis',
  )

  const unclaimed = page.locator('[data-attention-notice="unclaimed"]')
  await expect(
    unclaimed.getByText(/2 gimnasios sin reclamar\. 1 necesita seguimiento/),
  ).toBeVisible()
  await unclaimed.getByRole('link', { name: 'Ver los gimnasios sin reclamar' }).click()

  await expect(page).toHaveURL('/organizations?status=unclaimed')
  await expect(page.locator('[data-organization-row]')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Norte Sin Dueño' })).toBeVisible()
  const reads = fixture.requests.filter(
    (request) => request.path === '/backoffice/v1/organizations',
  )
  expect(reads.length).toBeGreaterThan(0)
  expect(
    reads.every((request) => new URLSearchParams(request.query).get('status') === 'unclaimed'),
  ).toBe(true)
})

test('nothing pending is said plainly rather than left as an empty board', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      attention: {
        panel: attentionPanelRecord({
          credential_verifications: {
            availability: 'available',
            pending_count: 0,
            oldest_requested_at: null,
            renewals_due_count: 0,
          },
          unclaimed_organizations: {
            availability: 'available',
            count: 0,
            oldest_created_at: null,
            needs_follow_up_count: 0,
          },
          repeated_failures: {
            availability: 'available',
            window_hours: 24,
            groups: [],
            groups_truncated: false,
            open_circuits: [],
          },
        }),
      },
    }),
  )

  await page.goto('/panel')

  await expect(
    page.getByText(
      'Ningún título espera revisión, y ninguna verificación vence pronto sin renovación abierta.',
    ),
  ).toBeVisible()
  await expect(page.getByText('Todos los gimnasios que Allfit creó ya tienen dueño.')).toBeVisible()
  await expect(page.getByText('Nada se está repitiendo en las últimas 24 horas.')).toBeVisible()
  await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(0)
})

test('an operator whose duties resolve no notice is told the base role grants nothing', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      attention: { refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto('/panel')

  await expect(page.getByText('No se pudo leer lo que necesita atención')).toBeVisible()
  await expect(page.getByText(/no basta por sí solo/)).toBeVisible()
})

test('the Backoffice starts on the panel', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({ session: activeSession(), attention: {} }),
  )

  await page.goto('/panel')

  await expect(page.locator('[data-backoffice-header]').getByText('Inicio')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Ir al inicio de Allfit Backoffice' }),
  ).toHaveAttribute('href', '/panel')

  await page.goto('/')
  await expect(page.locator('a', { hasText: 'Entrar al Backoffice' })).toHaveAttribute(
    'href',
    '/panel',
  )
})
