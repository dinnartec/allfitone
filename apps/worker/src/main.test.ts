import { beforeEach, expect, test } from 'bun:test'

import { createWorkerApp } from './main.js'
import type { ServerTelemetryAdapter } from '@allfitone/telemetry/posthog-node'

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-test-secret'
})

test('rejects cron requests without the exact bearer secret', async () => {
  const response = await createWorkerApp(async () => ({})).request('/cron/outbox')
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.has('access-control-allow-origin')).toBeFalse()
})

test('runs the batch after authenticating the Vercel cron', async () => {
  const captured: unknown[] = []
  const telemetry: ServerTelemetryAdapter = {
    capture: (event) => captured.push(event),
    shutdown: async () => undefined,
  }
  const response = await createWorkerApp(async () => ({ claimed: 0 }), telemetry).request(
    '/cron/outbox',
    {
      headers: { authorization: 'Bearer cron-test-secret' },
    },
  )
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ claimed: 0 })
  expect(captured).toHaveLength(1)
  expect(captured[0]).toMatchObject({
    event: 'worker.job.completed.v1',
    properties: { job: 'outbox_batch', outcome: 'completed' },
  })
})
