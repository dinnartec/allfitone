import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  mockBackofficeApi,
  reviewRecord,
} from './backoffice-api-mock'

/**
 * `OP-SUP-006` — reviewing a break-glass case that was used.
 *
 * What is asserted is what this screen has to say out loud: that the oldest debt is
 * first, that a case past its day is still reviewable rather than greyed out, that a
 * late verdict is recorded as late, and that the duty it asks for is not the one that
 * opened the window.
 */

function queue() {
  return [reviewRecord('CASE-2026-FRESH', 2), reviewRecord('CASE-2026-OLD', 30)]
}

test('the queue is a debt: the oldest case is first and the backlog is counted', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], reviews: queue() },
    }),
  )

  await page.goto('/break-glass')

  await expect(page.locator('[data-review-backlog]')).toContainText('2 casos esperan revisión')
  await expect(page.locator('[data-review-backlog]')).toContainText('1 ya pasó de las 24 horas')

  const cases = page.locator('[data-review-case]')
  await expect(cases.first()).toHaveAttribute('data-review-case', 'CASE-2026-OLD')
  await expect(cases.last()).toHaveAttribute('data-review-case', 'CASE-2026-FRESH')
})

test('a case past its day is still reviewable, and says the deadline passed', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], reviews: queue() },
    }),
  )

  await page.goto('/break-glass')

  const overdue = page.locator('[data-review-case="CASE-2026-OLD"]')
  await expect(overdue).toHaveAttribute('data-overdue', 'true')
  await expect(overdue.locator('[data-review-due]')).toContainText('Venció el plazo')
  await expect(overdue.locator('[data-review-due]')).toContainText('Sigue pendiente')

  // The buttons are there. Greying them out would turn a backlog into a permanent
  // hole in the audit, which is what the deadline exists to prevent.
  await expect(overdue.locator('[data-review-verdict="justified"]')).toBeEnabled()
  await expect(page.locator('[data-review-late-note]')).toContainText('sigue siendo obligatoria')
})

test('a late verdict is accepted and recorded as late', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], reviews: queue() },
    }),
  )

  await page.goto('/break-glass')

  const overdue = page.locator('[data-review-case="CASE-2026-OLD"]')
  await overdue.locator('[data-review-verdict="unjustified"]').click()

  await expect(page.locator('[data-review-outcome]')).toContainText('no justificado')
  await expect(page.locator('[data-review-outcome]')).toContainText('tardía')
  await expect(overdue.locator('[data-review-verdict-given]')).toBeVisible()
  await expect(overdue).toHaveAttribute('data-overdue', 'false')
  await expect(page.locator('[data-review-backlog]')).toContainText('1 caso espera revisión')
})

test('an incident says it asks somebody to act, before it is pressed', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], reviews: queue() },
    }),
  )

  await page.goto('/break-glass')

  const fresh = page.locator('[data-review-case="CASE-2026-FRESH"]')
  await expect(fresh.locator('[data-review-meaning="incident_opened"]')).toContainText(
    'pide que alguien haga algo',
  )

  await fresh.locator('[data-review-verdict="incident_opened"]').click()
  await expect(page.locator('[data-review-outcome]')).toContainText('Incidente abierto')
})

test('without the auditing duty the queue says which duty it needs', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto('/break-glass')

  await expect(page.locator('[data-review-refused]')).toContainText('audit_break_glass')
  await expect(page.locator('[data-review-refused]')).toContainText('quien lo aprobó')
  await expect(page.locator('[data-review-queue]')).toHaveCount(0)
})

test('a case somebody else just reviewed conflicts rather than taking a second verdict', async ({
  context,
  page,
}) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: {
        files: [],
        reviews: queue(),
        reviewRefusal: { status: 409, code: 'conflict' },
      },
    }),
  )

  await page.goto('/break-glass')

  await page
    .locator('[data-review-case="CASE-2026-FRESH"] [data-review-verdict="justified"]')
    .click()

  await expect(page.locator('[data-review-failure]')).toContainText('ya fue revisado')
  await expect(page.locator('[data-review-failure]')).toContainText('no se reescribe')
})

test('nothing on this screen leaks what the window actually read', async ({ context, page }) => {
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      breakGlass: { files: [], reviews: queue() },
    }),
  )

  await page.goto('/break-glass')

  const review = page.locator('[data-review-queue]')
  await expect(review.locator('[data-review-categories]').first()).toContainText(
    'prior_training_history',
  )
  // The category is metadata. The content behind it never travels to this screen.
  await expect(review).not.toContainText('@')
  await expect(review).not.toContainText('kg')
})
