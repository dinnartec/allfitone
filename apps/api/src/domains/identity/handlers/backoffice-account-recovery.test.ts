import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { AccountRecoveryService } from '../application/account-recovery.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'
import { backofficeAccountRecoveryRoutes } from './backoffice-account-recovery.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019b1000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019b1000-0000-7000-8000-000000000043'
const PERSON_ID = '019b1000-0000-7000-8000-000000000005'
const RECOVERY_ID = '019b1000-0000-7000-8000-000000000601'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000001'
const COMMAND_ID = '019b1000-0000-7000-8000-000000000602'
const CASE = 'CASE-2026-010'
const OPERATIONS = ['NEW-IDN-ACTION', 'OP-IDN-053', 'OP-IDN-054', 'OP-IDN-055']

const recovery: AllfitV1Schemas['BackofficeAccountRecoveryRequest'] = {
  request_id: RECOVERY_ID,
  person_id: PERSON_ID,
  state: 'awaiting_verification',
  contact_hint: '••••••••ct@example.test',
  case_reference: CASE,
  created_at: '2026-09-15T05:00:00.000Z',
  delivered_at: '2026-09-15T05:00:05.000Z',
  expires_at: '2026-09-15T05:15:05.000Z',
  confirmed_at: null,
  cancelled_at: null,
  failed_at: null,
  failure_code: null,
  send_count: 1,
  resendable: true,
  cancellable: true,
}

const recoveryState: AllfitV1Schemas['BackofficeAccountRecovery'] = {
  person_id: PERSON_ID,
  availability: 'available',
  unavailable_reason: null,
  contact_hint: '••••••••ct@example.test',
  can_start: false,
  requests: [recovery],
}

let captured: { operation: string; assistant: unknown; input: unknown }[] = []

function recoveryService(overrides: Partial<AccountRecoveryService> = {}): AccountRecoveryService {
  return {
    read: (assistant, input) => {
      captured.push({ operation: 'read', assistant, input })
      return Promise.resolve(recoveryState)
    },
    start: (assistant, input) => {
      captured.push({ operation: 'start', assistant, input })
      return Promise.resolve({ resource: recovery, replayed: false })
    },
    resend: (assistant, input) => {
      captured.push({ operation: 'resend', assistant, input })
      return Promise.resolve({ resource: recovery, replayed: false })
    },
    cancel: (assistant, input) => {
      captured.push({ operation: 'cancel', assistant, input })
      return Promise.resolve({ resource: recovery, replayed: false })
    },
    ...overrides,
  }
}

function sessionService(
  overrides: Partial<BackofficeAuthenticationService> = {},
): BackofficeAuthenticationService {
  return {
    resolveActor: async () => ({ personId: ACTOR_PERSON_ID, sessionId: ACTOR_SESSION_ID }),
    ...overrides,
  } as BackofficeAuthenticationService
}

function routes(
  service: AccountRecoveryService = recoveryService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeAccountRecoveryRoutes(service, sessions))
}

function request(
  path: string,
  init: {
    method?: string
    origin?: string
    cookie?: boolean
    headers?: Record<string, string>
    body?: string
  } = {},
): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN, ...init.headers })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

function commandRequest(
  path: string,
  overrides: {
    origin?: string
    cookie?: boolean
    headers?: Record<string, string>
    body?: string
  } = {},
): Request {
  return request(path, {
    method: 'POST',
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
    ...(overrides.cookie === undefined ? {} : { cookie: overrides.cookie }),
    headers: {
      'content-type': 'application/json',
      'idempotency-key': IDEMPOTENCY_KEY,
      'command-id': COMMAND_ID,
      ...overrides.headers,
    },
    body: overrides.body ?? JSON.stringify({ case_reference: CASE }),
  })
}

const START_PATH = `/people/${PERSON_ID}/account-recoveries`
const RESEND_PATH = `/people/${PERSON_ID}/account-recoveries/${RECOVERY_ID}/resends`
const CANCEL_PATH = `/people/${PERSON_ID}/account-recoveries/${RECOVERY_ID}/cancellation`

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice account recovery API contract', () => {
  test('T-IDN-RECOVERY-API-01 mounts NEW-IDN-ACTION and OP-IDN-053..048 with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      // Space reused these four numbers for onboarding operations. The operations
      // matrix assigns them here, so the surface is part of the filter until that
      // clash is settled in the matrix.
      .filter(
        (operation) =>
          OPERATIONS.includes(operation.allfitOperation) &&
          operation.path.startsWith('/backoffice/v1/'),
      )
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeAccountRecoveryRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(4)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-RECOVERY-API-02 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/people/:personId/account-recovery')
    expect(mounted).toContain('POST /backoffice/v1/people/:personId/account-recoveries')
    expect(mounted).toContain(
      'POST /backoffice/v1/people/:personId/account-recoveries/:requestId/resends',
    )
    expect(mounted).toContain(
      'POST /backoffice/v1/people/:personId/account-recoveries/:requestId/cancellation',
    )
  })

  test('T-IDN-RECOVERY-API-03 reads the recovery state as the operator, for the case', async () => {
    const response = await routes().fetch(
      request(`/people/${PERSON_ID}/account-recovery?case_reference=${CASE}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(recoveryState)
    expect(captured[0]?.assistant).toEqual({
      actorPersonId: ACTOR_PERSON_ID,
      actorSessionId: ACTOR_SESSION_ID,
    })
    expect(captured[0]?.input).toMatchObject({ caseReference: CASE, personId: PERSON_ID })
  })

  test('T-IDN-RECOVERY-API-04 refuses a read nobody can trace to a case before reaching the service', async () => {
    const answers = await Promise.all([
      routes().fetch(request(`/people/${PERSON_ID}/account-recovery`)),
      routes().fetch(request(`/people/${PERSON_ID}/account-recovery?case_reference=case%2010`)),
      routes().fetch(
        request(`/people/${PERSON_ID}/account-recovery?case_reference=${CASE}&email=a%40b.test`),
      ),
      routes().fetch(request(`/people/not-a-uuid/account-recovery?case_reference=${CASE}`)),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-RECOVERY-API-05 starts a recovery with the command and says when it replays', async () => {
    const first = await routes().fetch(commandRequest(START_PATH))
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual(recovery)
    expect(first.headers.get('idempotent-replay')).toBeNull()
    expect(captured[0]).toMatchObject({
      operation: 'start',
      input: {
        personId: PERSON_ID,
        caseReference: CASE,
        idempotencyKey: IDEMPOTENCY_KEY,
        commandId: COMMAND_ID,
      },
    })

    const replay = await routes(
      recoveryService({ start: async () => ({ resource: recovery, replayed: true }) }),
    ).fetch(commandRequest(START_PATH))
    expect(replay.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-IDN-RECOVERY-API-06 resends and cancels the recovery named in the path', async () => {
    const answers = await Promise.all([
      routes().fetch(commandRequest(RESEND_PATH)),
      routes().fetch(commandRequest(CANCEL_PATH)),
    ])

    expect(answers.map((response) => response.status)).toEqual([200, 200])
    expect(captured.map(({ operation }) => operation).sort()).toEqual(['cancel', 'resend'])
    for (const call of captured) {
      expect(call.input).toMatchObject({
        personId: PERSON_ID,
        recoveryId: RECOVERY_ID,
        caseReference: CASE,
      })
    }
  })

  test('T-IDN-RECOVERY-API-07 takes nothing but the case from the client and refuses a malformed command', async () => {
    const answers = await Promise.all([
      routes().fetch(
        commandRequest(START_PATH, {
          body: JSON.stringify({ case_reference: CASE, email: 'other@example.test' }),
        }),
      ),
      routes().fetch(commandRequest(START_PATH, { body: '{}' })),
      routes().fetch(
        commandRequest(START_PATH, { body: JSON.stringify({ case_reference: 'case 10' }) }),
      ),
      routes().fetch(commandRequest(START_PATH, { headers: { 'content-type': 'text/plain' } })),
      routes().fetch(commandRequest(START_PATH, { origin: 'https://attacker.test' })),
      routes().fetch(commandRequest(START_PATH, { headers: { 'idempotency-key': 'not-a-key' } })),
      routes().fetch(
        commandRequest(
          `/people/${PERSON_ID}/account-recoveries/a0000000-0000-4000-8000-000000000001/resends`,
        ),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422, 415, 403, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-RECOVERY-API-08 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['55000', 409],
      ['23505', 409],
      ['22023', 422],
      ['P0001', 429],
      ['40001', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          recoveryService({
            start: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(commandRequest(START_PATH)),
      ),
    )
    const broken = await routes(
      recoveryService({ start: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(commandRequest(START_PATH))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[5]?.headers.get('retry-after')).toBe('3600')
    expect(answers[6]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-IDN-RECOVERY-API-09 never reaches the service without a session that still resolves', async () => {
    const missing = await routes().fetch(commandRequest(START_PATH, { cookie: false }))
    const ended = await routes(
      recoveryService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request(`/people/${PERSON_ID}/account-recovery?case_reference=${CASE}`))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
