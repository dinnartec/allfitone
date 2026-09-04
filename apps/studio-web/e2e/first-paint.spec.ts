/**
 * What the first paint is allowed to claim.
 *
 * Two things were asserted before the app knew them, and both were visible as a
 * flash on every reload: the consent panel opened at people who had already
 * answered it, and the setup progress announced "step 1 of 3" to visitors who
 * were on their way to the access landing, which has no setup at all.
 *
 * Neither is a timing problem, so neither is fixed with a timer. The rule is
 * that a screen does not assert a state the app has not resolved.
 */
import { expect, test } from '@playwright/test'

import { activeMembership, createStudioApiFixture, installStudioApiMock } from './studio-api-mock'

test.describe('server-rendered first paint', () => {
  // No JavaScript means no hydration, so this is exactly the markup that
  // reaches the browser before any effect has run.
  test.use({ javaScriptEnabled: false })

  test('offers the privacy control without opening the consent panel', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Privacidad' })).toBeVisible()
    await expect(page.getByText('Analítica opcional')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Permitir analítica' })).toHaveCount(0)
  })

  test('does not announce a setup step it has not resolved', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('[data-studio-progress]')).toHaveCount(0)
  })
})

test('an undecided visitor still gets the consent panel once it is known', async ({ page }) => {
  // installStudioApiMock seeds a denied decision unless told otherwise, so an
  // undecided visitor has to be asked for explicitly.
  await installStudioApiMock(page, createStudioApiFixture({ signedOut: true }), {
    consent: 'undecided',
  })
  await page.goto('/')

  await expect(page.getByText('Analítica opcional')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Permitir analítica' })).toBeVisible()
})

test('a decided visitor never sees the consent panel', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture({ signedOut: true }))
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Privacidad' })).toBeVisible()
  await expect(page.getByText('Analítica opcional')).toHaveCount(0)
})

test('the setup progress appears once the step is actually known', async ({ page }) => {
  await installStudioApiMock(page, createStudioApiFixture())
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The space setup screen does know where the person is, so it says so. This
  // is the other half: the rule is "do not claim what you do not know", not
  // "never show progress".
  await expect(page.locator('[data-studio-progress]')).toHaveCount(1)
})

test('consulting an invitation is not step one of onboarding', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({
      memberships: [activeMembership],
      intercept: async (request) => {
        if (request.path === '/studio/v1/invitations/resolve') {
          await new Promise((resolve) => setTimeout(resolve, 15_000))
        }
        return undefined
      },
    }),
  )
  await page.goto(`/invitations#token=${'A'.repeat(43)}`)

  await expect(page.getByText('Consultando la invitación…')).toBeVisible()
  await expect(page.locator('[data-studio-progress]')).toHaveCount(0)
})
