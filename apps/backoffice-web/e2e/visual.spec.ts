import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  enrollmentAttempt,
  mockBackofficeApi,
} from './backoffice-api-mock'

test('captures the desktop credential entry', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Identifica tu acceso.' })).toBeVisible()
  await expect(page).toHaveScreenshot('backoffice-login-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  })
})

test('captures TOTP enrollment on tablet', async ({ context, page }) => {
  await page.setViewportSize({ width: 820, height: 1000 })
  await mockBackofficeApi(context, createBackofficeFixture({ attempt: enrollmentAttempt() }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Conecta tu autenticador.' })).toBeVisible()
  await expect(page).toHaveScreenshot('backoffice-enrollment-tablet.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  })
})

test('captures the confirmed AAL2 session', async ({ context, page }) => {
  await mockBackofficeApi(context, createBackofficeFixture({ session: activeSession() }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Acceso confirmado.' })).toBeVisible()
  await expect(page).toHaveScreenshot('backoffice-session-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  })
})
