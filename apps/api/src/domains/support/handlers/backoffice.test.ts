import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { PlatformAccessService } from '../application/index.js'
import { backofficePlatformAccessRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019e0000-0000-7000-8000-000000000001'
const ACTOR_SESSION_ID = '019e0000-0000-7000-8000-000000000002'
const TARGET_PERSON_ID = '019e0000-0000-7000-8000-000000000003'
const ROLE_ASSIGNMENT_ID = '019e0000-0000-7000-8000-000000000101'
const DUTY_ASSIGNMENT_ID = '019e0000-0000-7000-8000-000000000201'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'
const COMMAND_ID = '019e0000-0000-7000-8000-000000000301'
const NOW = '2026-09-06T12:00:00.000Z'
const VALID_TO = '2026-10-06T12:00:00.000Z'

const roleAssignment: AllfitV1Schemas['PlatformRoleAssignment'] = {
  id: ROLE_ASSIGNMENT_ID,
  person_id: TARGET_PERSON_ID,
  platform_role: 'allfit_admin',
  status: 'active',
  granted_by_person_id: ACTOR_PERSON_ID,
  granted_at: NOW,
  revoked_by_person_id: null,
  revoked_at: null,
}

const dutyAssignment: AllfitV1Schemas['PlatformDutyAssignment'] = {
  id: DUTY_ASSIGNMENT_ID,
  person_id: TARGET_PERSON_ID,
  duty_code: 'diagnose_support_metadata',
  actor_mode: 'A10',
  status: 'active',
  valid_from: NOW,
  valid_to: VALID_TO,
  required_aal: 2,
  granted_by_person_id: ACTOR_PERSON_ID,
  recertified_by_person_id: null,
  recertified_at: null,
  suspended_by_person_id: null,
  suspended_at: null,
  revoked_by_person_id: null,
  revoked_at: null,
  reason_code: 'CASE-001',
}

interface CapturedCall {
  operation: string
  input: Record<string, unknown>
}

let captured: CapturedCall[] = []

function accessService(overrides: Partial<PlatformAccessService> = {}): PlatformAccessService {
  const record =
    <T>(operation: string, resource: T) =>
    (_actor: unknown, input: Record<string, unknown>) => {
      captured.push({ operation, input })
      return Promise.resolve({ resource, replayed: false })
    }
  return {
    grantRole: record('grantRole', roleAssignment),
    revokeRole: record('revokeRole', roleAssignment),
    grantDuty: record('grantDuty', dutyAssignment),
    suspendDuty: record('suspendDuty', dutyAssignment),
    revokeDuty: record('revokeDuty', dutyAssignment),
    ...overrides,
  } as PlatformAccessService
}

function listService(overrides: Partial<PlatformAccessService> = {}): PlatformAccessService {
  return accessService({
    listRoles: (_actor, input) => {
      captured.push({ operation: 'listRoles', input })
      return Promise.resolve({ items: [roleAssignment], hasMore: false })
    },
    listDuties: (_actor, input) => {
      captured.push({ operation: 'listDuties', input })
      return Promise.resolve({ items: [dutyAssignment], hasMore: false })
    },
    ...overrides,
  })
}

function read(path: string, init: { origin?: string; cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN })
  if (init.cookie !== false) {
    headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  }
  return new Request(`https://api.example.test/backoffice/v1${path}`, { headers })
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
  access: PlatformAccessService = accessService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficePlatformAccessRoutes(access, sessions))
}

function request(
  path: string,
  init: {
    body?: unknown
    origin?: string
    cookie?: boolean
    idempotencyKey?: string
    commandId?: string
    contentType?: string | null
  } = {},
): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN })
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'application/json')
  if (init.cookie !== false) {
    headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  }
  if (init.idempotencyKey !== '') {
    headers.set('idempotency-key', init.idempotencyKey ?? IDEMPOTENCY_KEY)
  }
  if (init.commandId !== '') headers.set('command-id', init.commandId ?? COMMAND_ID)
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body ?? {}),
  })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice platform access API contract', () => {
  test('T-SUP-API-01 mounts every platform access operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) =>
        ['OP-SUP-007', 'OP-SUP-008', 'OP-SUP-010', 'OP-SUP-011'].includes(
          operation.allfitOperation,
        ),
      )
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficePlatformAccessRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(mounted).toEqual(contract)
  })

  test('T-SUP-API-02 mounts platform access below the real Backoffice surface prefix', () => {
    const mounted = mountedSurfacePaths()
    expect(mounted).toContain('POST /backoffice/v1/platform/role-assignments')
    expect(mounted).toContain('POST /backoffice/v1/platform/duty-assignments')
    expect(mounted).toContain('GET /backoffice/v1/platform/role-assignments')
    expect(mounted).toContain('GET /backoffice/v1/platform/duty-assignments')
  })

  test('T-SUP-API-03 grants a base role and returns the assignment projection', async () => {
    const response = await routes().fetch(
      request('/platform/role-assignments', {
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('idempotent-replay')).toBeNull()
    expect(await response.json()).toEqual(roleAssignment)
    expect(captured[0]?.operation).toBe('grantRole')
    expect(captured[0]?.input).toMatchObject({
      personId: TARGET_PERSON_ID,
      platformRole: 'allfit_admin',
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
    })
  })

  test('T-SUP-API-04 grants a duty with its window and opaque reason', async () => {
    const response = await routes().fetch(
      request('/platform/duty-assignments', {
        body: {
          person_id: TARGET_PERSON_ID,
          duty_code: 'diagnose_support_metadata',
          valid_to: VALID_TO,
          reason_code: 'CASE-001',
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(dutyAssignment)
    expect(captured[0]?.input).toMatchObject({
      personId: TARGET_PERSON_ID,
      dutyCode: 'diagnose_support_metadata',
      validFrom: undefined,
      validTo: VALID_TO,
      reasonCode: 'CASE-001',
    })
  })

  test('T-SUP-API-05 routes suspension and revocation to their own commands', async () => {
    const app = routes()
    const suspension = await app.fetch(
      request(`/platform/duty-assignments/${DUTY_ASSIGNMENT_ID}/suspension`),
    )
    const dutyRevocation = await app.fetch(
      request(`/platform/duty-assignments/${DUTY_ASSIGNMENT_ID}/revocation`),
    )
    const roleRevocation = await app.fetch(
      request(`/platform/role-assignments/${ROLE_ASSIGNMENT_ID}/revocation`),
    )

    expect([suspension.status, dutyRevocation.status, roleRevocation.status]).toEqual([
      200, 200, 200,
    ])
    expect(captured.map((call) => call.operation)).toEqual([
      'suspendDuty',
      'revokeDuty',
      'revokeRole',
    ])
    expect(captured[0]?.input).toMatchObject({ assignmentId: DUTY_ASSIGNMENT_ID })
    expect(captured[2]?.input).toMatchObject({ assignmentId: ROLE_ASSIGNMENT_ID })
  })

  test('T-SUP-API-06 refuses a duty code outside the closed catalogue', async () => {
    const response = await routes().fetch(
      request('/platform/duty-assignments', {
        body: {
          person_id: TARGET_PERSON_ID,
          duty_code: 'read_everything',
          valid_to: VALID_TO,
          reason_code: 'CASE-001',
        },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-07 refuses a reason code that carries free narrative', async () => {
    const response = await routes().fetch(
      request('/platform/duty-assignments', {
        body: {
          person_id: TARGET_PERSON_ID,
          duty_code: 'diagnose_support_metadata',
          valid_to: VALID_TO,
          reason_code: 'because Ada asked, <script>',
        },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-08 answers unauthenticated without a session cookie', async () => {
    const response = await routes().fetch(
      request('/platform/role-assignments', {
        cookie: false,
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(response.status).toBe(401)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-09 refuses a request from another origin before doing any work', async () => {
    const response = await routes().fetch(
      request('/platform/role-assignments', {
        origin: 'https://attacker.example.test',
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(response.status).toBe(403)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-10 requires both command identifiers in their contract formats', async () => {
    const app = routes()
    const missing = await app.fetch(
      request('/platform/role-assignments', {
        idempotencyKey: '',
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )
    const wrongVersion = await app.fetch(
      request('/platform/role-assignments', {
        commandId: IDEMPOTENCY_KEY,
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect([missing.status, wrongVersion.status]).toEqual([400, 400])
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-11 requires the canonical JSON representation', async () => {
    const response = await routes().fetch(
      request('/platform/role-assignments', {
        contentType: 'text/plain',
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(response.status).toBe(415)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-12 rejects a closure body that carries anything at all', async () => {
    const response = await routes().fetch(
      request(`/platform/duty-assignments/${DUTY_ASSIGNMENT_ID}/suspension`, {
        body: { reason_code: 'CASE-001' },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-13 maps every declared database failure to its problem response', async () => {
    const cases: Array<{ sqlState: string; status: number }> = [
      { sqlState: '42501', status: 403 },
      { sqlState: 'P0002', status: 404 },
      { sqlState: '22023', status: 422 },
      { sqlState: '23514', status: 409 },
      { sqlState: '23505', status: 409 },
      { sqlState: '40001', status: 409 },
    ]

    for (const { sqlState, status } of cases) {
      const failure = Object.assign(new Error('database rejected the command'), { code: sqlState })
      const response = await routes(
        accessService({
          grantRole: () => Promise.reject(failure),
        }),
      ).fetch(
        request('/platform/role-assignments', {
          body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
        }),
      )

      expect({ sqlState, status: response.status }).toEqual({ sqlState, status })
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      if (sqlState === '40001') expect(response.headers.get('retry-after')).toBe('1')
    }
  })

  test('T-SUP-API-14 answers unauthenticated when the session no longer resolves an actor', async () => {
    const response = await routes(
      accessService(),
      sessionService({
        resolveActor: () => Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(
      request('/platform/role-assignments', {
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(response.status).toBe(401)
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-15 lists the base role inventory with its page envelope', async () => {
    const response = await routes(listService()).fetch(read('/platform/role-assignments'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: [roleAssignment],
      page: { has_more: false, next_cursor: null },
    })
    expect(captured[0]?.input).toMatchObject({ limit: 25 })
  })

  test('T-SUP-API-16 passes the duty filters through untouched', async () => {
    const response = await routes(listService()).fetch(
      read(
        `/platform/duty-assignments?person_id=${TARGET_PERSON_ID}` +
          '&duty_code=audit_platform_access&status=expired&limit=5',
      ),
    )

    expect(response.status).toBe(200)
    expect(captured[0]?.input).toMatchObject({
      personId: TARGET_PERSON_ID,
      dutyCode: 'audit_platform_access',
      status: 'expired',
      limit: 5,
    })
  })

  test('T-SUP-API-17 refuses a filter outside its closed vocabulary', async () => {
    const app = routes(listService())
    const badDuty = await app.fetch(read('/platform/duty-assignments?duty_code=read_everything'))
    const badStatus = await app.fetch(read('/platform/duty-assignments?status=pending'))
    const badPerson = await app.fetch(read('/platform/duty-assignments?person_id=not-a-uuid'))

    expect([badDuty.status, badStatus.status, badPerson.status]).toEqual([422, 422, 422])
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-18 refuses a page size outside the contract bounds', async () => {
    const app = routes(listService())
    const tooLarge = await app.fetch(read('/platform/role-assignments?limit=101'))
    const zero = await app.fetch(read('/platform/role-assignments?limit=0'))
    const notANumber = await app.fetch(read('/platform/role-assignments?limit=many'))

    expect([tooLarge.status, zero.status, notANumber.status]).toEqual([422, 422, 422])
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-API-19 round-trips its own opaque cursor and rejects a forged one', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ rank: 0, grantedAt: NOW, id: ROLE_ASSIGNMENT_ID }),
    ).toString('base64url')
    const app = routes(
      listService({
        listRoles: (_actor, input) => {
          captured.push({ operation: 'listRoles', input })
          return Promise.resolve({ items: [roleAssignment], hasMore: true, nextCursor: cursor })
        },
      }),
    )

    const first = await app.fetch(read('/platform/role-assignments'))
    const next = await app.fetch(read(`/platform/role-assignments?cursor=${cursor}`))
    const forged = await app.fetch(read('/platform/role-assignments?cursor=not-base64url'))

    expect(await first.json()).toMatchObject({ page: { has_more: true, next_cursor: cursor } })
    expect(next.status).toBe(200)
    expect(captured[1]?.input).toMatchObject({
      cursor: { rank: 0, grantedAt: NOW, id: ROLE_ASSIGNMENT_ID },
    })
    expect(forged.status).toBe(422)
  })

  test('T-SUP-API-20 keeps the inventory unauthenticated without a session and closed to others', async () => {
    const app = routes(listService())
    const anonymous = await app.fetch(read('/platform/role-assignments', { cookie: false }))
    const foreign = await app.fetch(
      read('/platform/duty-assignments', { origin: 'https://attacker.example.test' }),
    )

    expect([anonymous.status, foreign.status]).toEqual([401, 403])
    expect(captured).toHaveLength(0)
  })

  test('T-SUP-IDEM-01 marks a replayed command and binds its hash to method and path', async () => {
    const hashes: Uint8Array[] = []
    const app = routes(
      accessService({
        grantRole: (_actor, input) => {
          hashes.push(input.requestHash)
          return Promise.resolve({ resource: roleAssignment, replayed: true })
        },
      }),
    )
    const body = { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' as const }

    const first = await app.fetch(request('/platform/role-assignments', { body }))
    const second = await app.fetch(
      request('/platform/role-assignments', {
        body: { platform_role: 'allfit_admin', person_id: TARGET_PERSON_ID },
      }),
    )

    expect(first.headers.get('idempotent-replay')).toBe('true')
    expect(second.status).toBe(201)
    expect(Buffer.from(hashes[0] ?? new Uint8Array()).toString('hex')).toBe(
      Buffer.from(hashes[1] ?? new Uint8Array()).toString('hex'),
    )
  })

  test('T-SUP-IDEM-02 gives two different resources two different command hashes', async () => {
    const hashes: Uint8Array[] = []
    const app = routes(
      accessService({
        grantRole: (_actor, input) => {
          hashes.push(input.requestHash)
          return Promise.resolve({ resource: roleAssignment, replayed: false })
        },
      }),
    )

    await app.fetch(
      request('/platform/role-assignments', {
        body: { person_id: TARGET_PERSON_ID, platform_role: 'allfit_admin' },
      }),
    )
    await app.fetch(
      request('/platform/role-assignments', {
        body: { person_id: ACTOR_SESSION_ID, platform_role: 'allfit_admin' },
      }),
    )

    expect(Buffer.from(hashes[0] ?? new Uint8Array()).toString('hex')).not.toBe(
      Buffer.from(hashes[1] ?? new Uint8Array()).toString('hex'),
    )
  })
})

function mountedSurfacePaths(): string[] {
  const app = new Hono()
  mountSurfaces(app)
  return app.routes
    .filter((route) => route.method !== 'ALL')
    .map((route) => `${route.method} ${route.path}`)
}
