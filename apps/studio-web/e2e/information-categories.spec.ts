import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  holderMembership,
  informationCategoryCatalog,
  installStudioApiMock,
} from './studio-api-mock'

const PATH = (organizationId: string) =>
  `/organizations/${organizationId}/clients/information-categories`

/*
 * `HU-STUDIO-034`. The screen exists so a member can read what each category
 * covers *and where it stops* before asking a client for it.
 *
 * The first criterion is satisfied by the summary alone: every one of the seven
 * carries its own limit in the same line. This is the assertion that fails the
 * day somebody swaps the summary for the longer description, which is written
 * in the client's voice and would leave the member reading about themselves.
 */
test('every category says where it stops, in the line the member reads', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
  await page.goto(PATH(activeMembership.organization_id))

  const body = page.locator('[data-category-register]')
  await expect(body).toContainText('sin datos de salud')
  await expect(body).toContainText('sin historia clínica')
  await expect(body).toContainText('Nunca podrás editarlas')
})

test('the seven categories are listed, in the order the story names them', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
  await page.goto(PATH(activeMembership.organization_id))

  const cards = page.locator('[data-category-card]')
  await expect(cards).toHaveCount(7)
  await expect(cards.first()).toHaveAttribute('data-category-card', 'relationship_training')
  await expect(cards.last()).toHaveAttribute('data-category-card', 'nutrition_guidance')
})

/*
 * Two voices, and the screen must not blur them. The summary speaks to the
 * professional ("que le asignes"); the description speaks to the client ("que
 * te asignemos"). Showing the second one unlabelled would leave the member
 * wondering who "tú" is, so it is disclosed as what the client will read.
 */
test('the client wording is disclosed as the client wording, not as the page voice', async ({
  page,
}) => {
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [activeMembership] }))
  await page.goto(PATH(activeMembership.organization_id))

  const card = page.locator('[data-category-card="relationship_training"]')
  await expect(card).toContainText('Sesiones que le asignes')
  await expect(card).not.toContainText('Las sesiones que te asignemos')

  await card.getByRole('button', { name: 'Ver lo que lee tu cliente' }).click()
  await expect(card).toContainText('Lo que verá tu cliente')
  await expect(card).toContainText('Las sesiones que te asignemos')
  await expect(card).toContainText('Y para qué se lo pides')
})

/*
 * A coach attends clients and therefore needs to know what they may consult
 * about them. The screen does not depend on being able to invite anyone.
 */
test('a coach reads it too, without being able to invite', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ memberships: [holderMembership] }))
  await page.goto(PATH(holderMembership.organization_id))

  await expect(page.locator('[data-category-card]')).toHaveCount(7)
})

/*
 * Seven or nothing. Six categories on screen would teach a member that the
 * seventh does not exist, which is worse than an error they can retry.
 */
test('a short catalogue is an error, not a shorter list', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({
      memberships: [activeMembership],
      informationCategories: informationCategoryCatalog.slice(0, 6),
    }),
  )
  await page.goto(PATH(activeMembership.organization_id))

  await expect(page.getByText('No pudimos cargar las categorías')).toBeVisible()
  await expect(page.locator('[data-category-card]')).toHaveCount(0)
})

test('a temporary failure offers a retry', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({
      memberships: [activeMembership],
      intercept: (request) =>
        request.path === '/catalog/v1/information-categories'
          ? { status: 503, body: { error: 'upstream-unavailable' } }
          : undefined,
    }),
  )
  await page.goto(PATH(activeMembership.organization_id))

  await expect(page.getByText('No pudimos cargar las categorías')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})

/*
 * The reference is reachable from the one place the member is blocked today:
 * the invitation form, which cannot offer a single permission until somebody
 * publishes the catalogue. Without this link that screen is a dead end.
 */
test('the blocked invitation form points at it', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [activeMembership], offerableScopes: [] }),
  )
  await page.goto(`/organizations/${activeMembership.organization_id}/clients/invitations/new`)

  await expect(page.getByText('Todavía no hay permisos publicados')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver las categorías de información' })).toBeVisible()
})
