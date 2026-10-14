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

  // The question the founder is actually asking, answered from the training itself
  // rather than borrowed from the Studio figure next to it.
  const training = page.locator('[data-business-metric="active_people_this_week"]')
  await expect(training.locator('[data-business-value]')).toHaveText('118')
  await expect(training.locator('[data-business-period]')).toContainText('Del ')
  await expect(training.locator('[data-business-note]')).toHaveCount(0)
  await expect(training).toHaveAttribute('data-availability', 'available')

  // Money, apart from the counts and one line per currency: a total mixing pesos and
  // dollars would be a number that means nothing.
  const money = page.locator('[data-business-money="billed_this_month"]')
  await expect(money.locator('[data-business-value]')).toHaveCount(2)
  await expect(money.locator('[data-business-value]').first()).toContainText('79.600')
  await expect(money.locator('[data-business-value]').last()).toContainText('11,98')
  await expect(money.locator('[data-business-note]')).toHaveCount(0)

  // The two routes to Pro are two figures. One is withheld, which is not a zero.
  const paying = page.locator('[data-business-metric="pro_people_paying_allfit"]')
  await expect(paying.locator('[data-business-value]')).toHaveText('6')
  const throughGym = page.locator('[data-business-metric="pro_people_through_organization"]')
  await expect(throughGym).toHaveAttribute('data-availability', 'below_threshold')
  await expect(throughGym.locator('[data-business-value]')).toHaveText('—')

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
