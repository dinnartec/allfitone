import { describe, expect, test } from 'bun:test'

import type { TelemetryEvent } from './index.js'
import {
  createClientTelemetryRuntime,
  type ClientTelemetryAdapter,
  type ClientTelemetryRuntimeScheduler,
} from './client-runtime.js'

const DISTINCT_ID = `a1_${'A'.repeat(43)}`
const NEXT_DISTINCT_ID = `a1_${'B'.repeat(43)}`
const event: TelemetryEvent = {
  event: 'client.screen.viewed.v1',
  properties: {
    surface: 'studio',
    service: 'studio-web',
    environment: 'production',
    release: 'test',
    platform: 'web',
    screen: 'studio.entry',
  },
}

describe('client telemetry runtime', () => {
  test('does not request the gate or capture before consent and identity', async () => {
    const harness = createHarness([true])

    harness.runtime.capture(event)
    harness.runtime.reconcile({ allowed: false, distinctId: DISTINCT_ID })
    await settle()

    expect(harness.gateRequests).toBe(0)
    expect(harness.adapter.starts).toEqual([])
    expect(harness.adapter.captures).toEqual([])
  })

  test('closes at TTL expiry and never backfills disabled-period events', async () => {
    const harness = createHarness([true, false, true])

    harness.runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()
    expect(harness.runtime.snapshot()).toEqual({ active: true })

    harness.runtime.capture(event)
    expect(harness.adapter.captures).toHaveLength(1)

    await harness.scheduler.advance(300_000)
    expect(harness.runtime.snapshot()).toEqual({ active: false })
    harness.runtime.capture(event)
    await settle()
    expect(harness.adapter.captures).toHaveLength(1)
    expect(harness.adapter.stops).toBeGreaterThan(0)

    await harness.scheduler.advance(300_000)
    await settle()
    expect(harness.runtime.snapshot()).toEqual({ active: true })
    expect(harness.adapter.captures).toHaveLength(1)
  })

  test('fails closed on timeout and retries without awaiting a hung request', async () => {
    const harness = createHarness(['pending', true])

    harness.runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()
    await harness.scheduler.advance(5_000)
    await settle()
    expect(harness.runtime.snapshot()).toEqual({ active: false })

    await harness.scheduler.advance(300_000)
    await settle()
    expect(harness.gateRequests).toBe(2)
    expect(harness.runtime.snapshot()).toEqual({ active: true })
  })

  test('does not let pending SDK shutdown block gate validation', async () => {
    const adapter = new FakeAdapter()
    adapter.stop = () => new Promise<void>(() => undefined)
    let gateRequests = 0
    const runtime = createClientTelemetryRuntime({
      adapter,
      gateUrl: 'https://api.example.test/studio/v1/telemetry-config',
      noticeVersion: 'analytics-v1',
      fetch: async () => {
        gateRequests += 1
        return gateResponse(true)
      },
    })

    runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()

    expect(gateRequests).toBe(1)
    expect(runtime.snapshot()).toEqual({ active: true })
  })

  test('treats gate errors and invalid responses as disabled until a later retry', async () => {
    const adapter = new FakeAdapter()
    const scheduler = new FakeScheduler()
    const responses = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(Response.json({ enabled: 'yes', notice_version: 'analytics-v1' })),
      () => Promise.resolve(gateResponse(true)),
    ]
    const runtime = createClientTelemetryRuntime({
      adapter,
      gateUrl: 'https://api.example.test/studio/v1/telemetry-config',
      noticeVersion: 'analytics-v1',
      fetch: () => responses.shift()?.() ?? Promise.resolve(gateResponse(false)),
      scheduler,
    })

    runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()
    expect(runtime.snapshot()).toEqual({ active: false })

    await scheduler.advance(300_000)
    expect(runtime.snapshot()).toEqual({ active: false })

    await scheduler.advance(300_000)
    expect(runtime.snapshot()).toEqual({ active: true })
    expect(adapter.starts).toEqual([DISTINCT_ID])
  })

  test('stale gate and start results cannot reactivate after denial or identity change', async () => {
    let resolveGate: ((response: Response) => void) | undefined
    const adapter = new FakeAdapter()
    const scheduler = new FakeScheduler()
    const runtime = createClientTelemetryRuntime({
      adapter,
      gateUrl: 'https://api.example.test/studio/v1/telemetry-config',
      noticeVersion: 'analytics-v1',
      fetch: () =>
        new Promise<Response>((resolve) => {
          resolveGate = resolve
        }),
      scheduler,
    })

    runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()
    runtime.reconcile({ allowed: false, distinctId: null })
    resolveGate?.(gateResponse(true))
    await settle()
    expect(runtime.snapshot()).toEqual({ active: false })
    expect(adapter.starts).toEqual([])

    runtime.reconcile({ allowed: true, distinctId: DISTINCT_ID })
    await settle()
    runtime.reconcile({ allowed: true, distinctId: NEXT_DISTINCT_ID })
    resolveGate?.(gateResponse(true))
    await settle()
    expect(adapter.starts).not.toContain(DISTINCT_ID)
  })
})

function createHarness(gates: Array<boolean | 'pending'>) {
  const adapter = new FakeAdapter()
  const scheduler = new FakeScheduler()
  let gateRequests = 0
  const runtime = createClientTelemetryRuntime({
    adapter,
    gateUrl: 'https://api.example.test/studio/v1/telemetry-config',
    noticeVersion: 'analytics-v1',
    fetch: () => {
      gateRequests += 1
      const next = gates.shift()
      return next === 'pending'
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(gateResponse(next === true))
    },
    scheduler,
  })
  return {
    adapter,
    runtime,
    scheduler,
    get gateRequests() {
      return gateRequests
    },
  }
}

class FakeAdapter implements ClientTelemetryAdapter {
  readonly captures: TelemetryEvent[] = []
  readonly starts: string[] = []
  stops = 0

  async start(distinctId: string): Promise<boolean> {
    this.starts.push(distinctId)
    return true
  }

  async stop(): Promise<void> {
    this.stops += 1
  }

  capture(value: TelemetryEvent): void {
    this.captures.push(value)
  }
}

class FakeScheduler implements ClientTelemetryRuntimeScheduler {
  private nowValue = 0
  private nextId = 1
  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  now = () => this.nowValue

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++
    this.timers.set(id, { at: this.nowValue + delayMs, callback })
    return id
  }

  clearTimeout = (id: unknown): void => {
    if (typeof id === 'number') this.timers.delete(id)
  }

  async advance(delayMs: number): Promise<void> {
    const target = this.nowValue + delayMs
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      this.timers.delete(next[0])
      this.nowValue = next[1].at
      next[1].callback()
      await settle()
    }
    this.nowValue = target
    await settle()
  }
}

function gateResponse(enabled: boolean): Response {
  return Response.json({ enabled, notice_version: 'analytics-v1' })
}

async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}
