import { expect, test } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  installStudioApiMock,
  relationshipHistory,
  relationshipHistoryClosedByUs,
  relationshipState,
  secondActiveMembership,
} from './studio-api-mock'

const RELATIONSHIP = relationshipState.relationship_id
const HISTORY_PATH = `/organizations/${activeMembership.organization_id}/clients/${RELATIONSHIP}/history`

test('an owner reaches the history from the relationship and reads it newest first', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)

  // The way somebody actually gets here, rather than by typing the URL.
  await page.goto(`/organizations/${activeMembership.organization_id}/clients/${RELATIONSHIP}`)
  await page.getByRole('link', { name: 'Ver la historia' }).click()
  await expect(page).toHaveURL(new RegExp(`${HISTORY_PATH}$`))

  const entries = page.locator('[data-relationship-history-entry] [data-history-title]')
  await expect(entries).toHaveCount(relationshipHistory.length)

  /*
   * The order is the point of the screen, so it is asserted as a whole rather
   * than by sampling one line. The two middle entries share an instant — that is
   * what a reassignment produces — and they still have to come out in a stable
   * order rather than swapping between loads.
   */
  await expect(entries).toHaveText([
    'Ana Álvarez cerró el vínculo',
    'Diana Entrante pasó a atenderla',
    'Camilo Saliente dejó de atenderla',
    'Ana Álvarez concedió su contexto de salud',
    'Ana Álvarez entró como clienta',
  ])
})

/*
 * Criterion 3. The person's reason is hers and the server withholds it, so the
 * screen has to explain the silence — otherwise it reads either as «she said
 * nothing» or as the product hiding something.
 */
test('a closure the person declared says so, without inventing a reason', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  const closure = page.locator('[data-relationship-history-entry][data-kind="relationship_ended"]')
  await expect(closure.locator('[data-history-title]')).toHaveText('Ana Álvarez cerró el vínculo')
  await expect(closure.locator('[data-history-reason]')).toHaveCount(0)
  await expect(closure.locator('[data-history-note]')).toContainText('es suyo')
})

test('a closure the gym declared shows the reason it gave', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    relationshipHistory: relationshipHistoryClosedByUs,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  const closure = page.locator('[data-relationship-history-entry][data-kind="relationship_ended"]')
  await expect(closure.locator('[data-history-title]')).toHaveText('El gimnasio cerró el vínculo')
  await expect(closure.locator('[data-history-reason]')).toContainText('Dejó de asistir sin avisar')
  await expect(closure.locator('[data-history-note]')).toHaveCount(0)
})

test('a history that fits in one page does not offer to load more', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  await expect(page.locator('[data-relationship-history-entry]')).toHaveCount(
    relationshipHistory.length,
  )
  await expect(page.locator('[data-relationship-history-more]')).toHaveCount(0)
})

/*
 * The screen asks for 25 at a time, so a second page needs more than 25 events
 * to exist at all. Generated rather than written out: what is being tested is
 * that pressing the button appends the next page instead of replacing the
 * first, and that the button then goes away — not the wording of thirty lines.
 */
test('a history longer than a page is completed by the button, not replaced', async ({ page }) => {
  const longHistory = Array.from({ length: 30 }, (_, index) => ({
    type: 'consent_decided',
    occurred_at: new Date(Date.UTC(2026, 8, 30 - index, 10, 0, 0)).toISOString(),
    source_id: `01991600-7000-7000-8000-${String(index).padStart(12, '0')}`,
    detail: { scope_code: 'body_progress', decision: index % 2 === 0 ? 'accepted' : 'revoked' },
  }))
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    relationshipHistory: longHistory,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  const entries = page.locator('[data-relationship-history-entry]')
  await expect(entries).toHaveCount(25)

  await page.locator('[data-relationship-history-more]').click()

  await expect(entries).toHaveCount(30)
  await expect(page.locator('[data-relationship-history-more]')).toHaveCount(0)
})

test('an empty history says what will appear there, not that something failed', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    relationshipHistory: [],
  })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  await expect(page.locator('[data-relationship-history-empty]')).toBeVisible()
  await expect(page.getByText('Todavía no hay nada que contar')).toBeVisible()
})

/*
 * A coach reads a shorter history than an owner, because the row policy shows
 * them only their own assignment. Saying so is the difference between a short
 * list and a complete one.
 */
test('a coach is told the history they see is partial', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: coachedTeam(),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(
    `/organizations/${secondActiveMembership.organization_id}/clients/${RELATIONSHIP}/history`,
  )

  await expect(page.locator('[data-relationship-history-partial]')).toBeVisible()
  await expect(page.getByText('Ves tu parte de esta historia')).toBeVisible()
})

test('a relationship that cannot be reached says so and offers the way back', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    relationshipState: null,
  })
  await installStudioApiMock(page, fixture)
  await page.goto(HISTORY_PATH)

  await expect(page.locator('[data-relationship-history][data-unreachable]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver a clientes' })).toBeVisible()
})
