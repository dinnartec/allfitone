import type { TelemetryEvent } from './index.js'

const DEFAULT_GATE_TTL_MS = 5 * 60_000
const DEFAULT_GATE_TIMEOUT_MS = 5_000
const ANALYTICS_DISTINCT_ID = /^a[1-9][0-9]*_[A-Za-z0-9_-]{43}$/

export interface ClientTelemetryAdapter {
  start(distinctId: string): Promise<boolean>
  stop(): Promise<void>
  capture(event: TelemetryEvent): void
}

export interface ClientTelemetryRuntimeScheduler {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ClientTelemetryRuntimeState {
  active: boolean
}

export interface ClientTelemetryRuntime {
  capture(event: TelemetryEvent): void
  dispose(): void
  reconcile(input: { allowed: boolean; distinctId: string | null }): void
  snapshot(): ClientTelemetryRuntimeState
  subscribe(listener: () => void): () => void
}

export interface ClientTelemetryRuntimeOptions {
  adapter: ClientTelemetryAdapter
  gateUrl: string
  noticeVersion: string
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  gateTimeoutMs?: number
  gateTtlMs?: number
  scheduler?: ClientTelemetryRuntimeScheduler
}

/**
 * Consent-aware remote gate controller shared by every client surface.
 *
 * It deliberately has no event queue: events only leave the process while the
 * current consent, identity and remote gate generation are all active.
 */
export function createClientTelemetryRuntime(
  options: ClientTelemetryRuntimeOptions,
): ClientTelemetryRuntime {
  const scheduler = options.scheduler ?? defaultScheduler()
  const fetchGate = options.fetch ?? ((input, init) => fetch(input, init))
  const gateTimeoutMs = options.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS
  const gateTtlMs = options.gateTtlMs ?? DEFAULT_GATE_TTL_MS
  const listeners = new Set<() => void>()
  const state: ClientTelemetryRuntimeState = { active: false }

  let allowed = false
  let distinctId: string | null = null
  let generation = 0
  let timer: unknown
  let requestController: AbortController | undefined

  const runtime: ClientTelemetryRuntime = {
    capture(event) {
      if (!state.active) return
      options.adapter.capture(event)
    },
    dispose() {
      generation += 1
      allowed = false
      distinctId = null
      cancelScheduledWork()
      setActive(false)
      void stopAdapter()
    },
    reconcile(input) {
      const nextDistinctId = validDistinctId(input.distinctId) ? input.distinctId : null
      const nextAllowed = input.allowed && nextDistinctId !== null
      if (allowed === nextAllowed && distinctId === nextDistinctId) return

      generation += 1
      allowed = nextAllowed
      distinctId = nextDistinctId
      cancelScheduledWork()
      setActive(false)
      const currentGeneration = generation
      if (!eligible(currentGeneration)) {
        void stopAdapter()
        return
      }
      void refresh(currentGeneration)
    },
    snapshot() {
      return { ...state }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return runtime

  async function refresh(currentGeneration: number): Promise<void> {
    setActive(false)
    void stopAdapter()
    if (!eligible(currentGeneration)) return

    const enabled = await requestGate(currentGeneration)
    if (!eligible(currentGeneration)) return
    if (!enabled) {
      scheduleRefresh(currentGeneration)
      return
    }

    const identity = distinctId
    if (!identity) return
    const started = await options.adapter.start(identity).catch(() => false)
    if (!eligible(currentGeneration) || distinctId !== identity) {
      if (started) await stopAdapter()
      return
    }
    if (!started) {
      scheduleRefresh(currentGeneration)
      return
    }

    setActive(true)
    scheduleRefresh(currentGeneration)
  }

  async function requestGate(currentGeneration: number): Promise<boolean> {
    const controller = new AbortController()
    requestController = controller
    let timeout: unknown
    try {
      const value: unknown = await Promise.race([
        fetchGate(options.gateUrl, { credentials: 'omit', signal: controller.signal }).then(
          async (response) => {
            if (!response.ok) return null
            return response.json().catch(() => null)
          },
        ),
        new Promise<never>((_, reject) => {
          timeout = scheduler.setTimeout(() => {
            controller.abort()
            reject(new Error('Telemetry gate timed out'))
          }, gateTimeoutMs)
        }),
      ])
      if (!eligible(currentGeneration)) return false
      return (
        isRecord(value) && value.enabled === true && value.notice_version === options.noticeVersion
      )
    } catch {
      return false
    } finally {
      if (timeout !== undefined) scheduler.clearTimeout(timeout)
      if (requestController === controller) requestController = undefined
    }
  }

  function scheduleRefresh(currentGeneration: number): void {
    if (!eligible(currentGeneration)) return
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = scheduler.setTimeout(() => {
      timer = undefined
      if (!eligible(currentGeneration)) return
      void refresh(currentGeneration)
    }, gateTtlMs)
  }

  function cancelScheduledWork(): void {
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = undefined
    requestController?.abort()
    requestController = undefined
  }

  function eligible(currentGeneration: number): boolean {
    return generation === currentGeneration && allowed && distinctId !== null
  }

  async function stopAdapter(): Promise<void> {
    await options.adapter.stop().catch(() => undefined)
  }

  function setActive(active: boolean): void {
    if (state.active === active) return
    state.active = active
    for (const listener of listeners) listener()
  }
}

function defaultScheduler(): ClientTelemetryRuntimeScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

function validDistinctId(value: string | null): value is string {
  return typeof value === 'string' && ANALYTICS_DISTINCT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
