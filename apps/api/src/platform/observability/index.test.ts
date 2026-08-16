import { describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import {
  measureStudioRequestPhase,
  measureRequestPhase,
  requestTiming,
  recordIdentityPasswordResetWebhook,
  recordStudioAuthCallback,
  recordStudioLogout,
  recordStudioMembershipDestination,
  recordStudioOrganizationQuery,
  recordStudioRegistrationIncomplete,
  studioRequestTiming,
} from './index.js'

describe('Studio operational counters', () => {
  test('emits closed callback outcomes without provider or actor details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioAuthCallback('failed', 'state-mismatch')

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.callback',
      value: 1,
      dimensions: { outcome: 'failed', reason: 'state-mismatch' },
    })
    info.mockRestore()
  })

  test('emits registration and membership counters with non-identifying dimensions', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioRegistrationIncomplete()
    recordStudioMembershipDestination('multiple')

    expect(info.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      {
        kind: 'counter',
        name: 'studio.registration.incomplete',
        value: 1,
        dimensions: {},
      },
      {
        kind: 'counter',
        name: 'studio.membership.destination',
        value: 1,
        dimensions: { destination: 'multiple' },
      },
    ])
    info.mockRestore()
  })

  test('emits a closed logout trigger and outcome without session details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioLogout('inactivity', 'partial')

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.logout',
      value: 1,
      dimensions: { trigger: 'inactivity', outcome: 'partial' },
    })
    info.mockRestore()
  })

  test('emits closed organization query dimensions without organization or person details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioOrganizationQuery('memberships', 'listed')
    recordStudioOrganizationQuery('roles', 'not-modified')

    expect(info.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      {
        kind: 'counter',
        name: 'studio.organization.memberships',
        value: 1,
        dimensions: { outcome: 'listed' },
      },
      {
        kind: 'counter',
        name: 'studio.organization.roles',
        value: 1,
        dimensions: { outcome: 'not-modified' },
      },
    ])
    info.mockRestore()
  })

  test('emits the closed password-reset webhook outcome without identity details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordIdentityPasswordResetWebhook('account-absent')

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      kind: 'counter',
      name: 'identity.password_reset.webhook',
      value: 1,
      dimensions: { outcome: 'account-absent' },
    })
    info.mockRestore()
  })
})

describe('Studio request timing', () => {
  test('emits safe phase timings and a route template', async () => {
    const app = new Hono()
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      app.use('/studio/v1/*', studioRequestTiming())
      app.get('/studio/v1/organizations/:organizationId', async (c) => {
        await measureStudioRequestPhase('session-db', async () => Promise.resolve())
        return c.json({ ok: true })
      })

      const response = await app.request(
        '/studio/v1/organizations/0199c000-0000-7000-8000-000000000099',
      )
      const timing = response.headers.get('server-timing') ?? ''
      const message = String(info.mock.calls[0]?.[0])
      expect(timing).toContain('session-db;dur=')
      expect(timing).toContain('total;dur=')
      expect(info).toHaveBeenCalledTimes(1)
      expect(message).toContain('/studio/v1/organizations/:organizationId')
      expect(message).not.toContain('0199c000-0000-7000-8000-000000000099')
    } finally {
      info.mockRestore()
    }
  })

  test('emits the closed slow-request alert above one second', async () => {
    const app = new Hono()
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    const moments = [0, 1_001]
    const now = spyOn(globalThis.performance, 'now').mockImplementation(
      () => moments.shift() ?? 1_001,
    )
    try {
      app.use('/studio/v1/*', studioRequestTiming())
      app.get('/studio/v1/session', (c) => c.json({ ok: true }))

      await app.request('/studio/v1/session')

      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
        kind: 'alert',
        name: 'studio.http.slow_request',
        value_ms: 1_001,
        dimensions: { operation: '/studio/v1/session', outcome: 'success', region: 'local' },
      })
    } finally {
      now.mockRestore()
      warn.mockRestore()
      info.mockRestore()
    }
  })
})

describe('shared request timing', () => {
  test('classifies direct WorkOS phases separately on Backoffice', async () => {
    const app = new Hono()
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      app.use('/backoffice/v1/*', requestTiming('backoffice'))
      app.post('/backoffice/v1/auth/password', async (c) => {
        await measureRequestPhase('workos-refresh', async () => Promise.resolve())
        return c.json({ ok: true })
      })

      const response = await app.request('/backoffice/v1/auth/password', { method: 'POST' })
      const message = JSON.parse(String(info.mock.calls[0]?.[0])) as {
        dimensions: { external_dependency: string; operation: string }
      }

      expect(response.headers.get('server-timing')).toContain('workos-refresh;dur=')
      expect(message.dimensions).toEqual(
        expect.objectContaining({
          external_dependency: 'workos',
          operation: '/backoffice/v1/auth/password',
        }),
      )
    } finally {
      info.mockRestore()
    }
  })
})
