import { expect, test } from '@playwright/test'

import {
  activeSession,
  businessPanelRecord,
  createBackofficeFixture,
  mockBackofficeApi,
} from './backoffice-api-mock'

test('every figure arrives with its period, and what cannot be computed is blank rather than zero', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))

  await page.goto('/panel')

  const registered = page.locator('[data-business-metric="registered_people"]')
  await expect(registered.locator('[data-business-value]')).toHaveText('1.284')
  await expect(registered.locator('[data-business-period]')).toContainText('Total hasta')

  const arrivals = page.locator('[data-business-metric="new_people_this_week"]')
  await expect(arrivals.locator('[data-business-value]')).toHaveText('37')
  await expect(arrivals.locator('[data-business-period]')).toContainText('Del ')

  // The question the founder is actually asking has no answer at all, and says so
  // instead of borrowing the Studio figure next to it.
  const training = page.locator('[data-business-metric="active_people_this_week"]')
  await expect(training.locator('[data-business-value]')).toHaveText('—')
  await expect(training.locator('[data-business-note]')).toContainText('No es cero')
  await expect(training).toHaveAttribute('data-availability', 'not_modelled')

  const money = page.locator('[data-business-metric="billed_this_month"]')
  await expect(money.locator('[data-business-value]')).toHaveText('—')
  await expect(money.locator('[data-business-note]')).toContainText('todavía no guarda pagos')

  // A true zero is a fact about the business and is published as one.
  const unclaimed = page.locator('[data-business-metric="unclaimed_organizations"]')
  await expect(unclaimed.locator('[data-business-value]')).toHaveText('0')
  await expect(unclaimed.locator('[data-business-note]')).toHaveCount(0)
})

test('a group too small to publish is withheld, and says why without naming anybody', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))

  await page.goto('/panel')

  const studio = page.locator('[data-business-metric="studio_active_professionals_this_week"]')
  await expect(studio.locator('[data-business-value]')).toHaveText('—')
  await expect(studio.locator('[data-business-note]')).toHaveText(
    'Menos de 5 personas. No se publica para que ninguna cifra pueda señalar a alguien.',
  )
  await expect(studio.getByText('Grupo muy pequeño', { exact: true })).toBeVisible()

  const panel = page.locator('[data-business-panel]')
  await expect(panel).not.toContainText('@')
})

test('without the metrics duty the figures are refused, and what needs attention still loads', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      business: { refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto('/panel')

  await expect(page.locator('[data-business-refused]')).toContainText('view_platform_metrics')
  await expect(page.locator('[data-business-panel]')).toHaveCount(0)
  await expect(page.locator('[data-attention-panel]')).toBeVisible()
})

test('a figure the API sends without a period is not shown at all', async ({ context, page }) => {
  const record = businessPanelRecord()
  const [first] = record.metrics
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      business: {
        panel: businessPanelRecord({
          metrics: [
            ...record.metrics.slice(1),
            {
              key: first?.key ?? 'registered_people',
              availability: 'available',
              value: 1284,
              reason: null,
              period: { kind: 'total', from: null, to: '' },
            },
          ],
        }),
      },
    }),
  )

  await page.goto('/panel')

  await expect(page.locator('[data-business-metric="organizations"]')).toBeVisible()
  await expect(page.locator('[data-business-metric="registered_people"]')).toHaveCount(0)
})
