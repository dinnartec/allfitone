import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import type { CredentialVerificationService } from '../application/credential-verification.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'
import { backofficeCredentialVerificationRoutes } from './backoffice-credential-verification.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019aa000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019aa000-0000-7000-8000-000000000023'
const REQUEST_ID = '019aa000-0000-7000-8000-000000000501'
const CREDENTIAL_ID = '019aa000-0000-7000-8000-000000000601'
const HOLDER_ID = '019aa000-0000-7000-8000-000000000005'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111601'
const COMMAND_ID = '019aa000-0000-7000-8000-000000000701'

const queued: AllfitV1Schemas['CredentialVerificationRequest'] = {
  request_id: REQUEST_ID,
  kind: 'initial',
  requested_at: '2026-09-13T15:00:00.000Z',
  credential_id: CREDENTIAL_ID,
  credential_type_code: 'professional_license',
  credential_type_name: 'Licencia o matrícula profesional',
  issuer: 'Colegio Colombiano de Fisioterapeutas',
  credential_name: 'Tarjeta profesional',
  credential_identifier: 'TP-12345',
  issued_on: '2019-06-01',
  expires_on: null,
  verification_url: 'https://example.test/registry/TP-12345',
  holder_person_id: HOLDER_ID,
  holder_given_name: 'Professional',
  holder_family_name: 'Epsilon',
  suggested_method: 'official_registry_lookup',
  previous_result: null,
  previous_valid_to: null,
  viewer_can_decide: true,
}

const outcome: AllfitV1Schemas['CredentialVerificationOutcome'] = {
  request_id: REQUEST_ID,
  kind: 'initial',
  status: 'resolved',
  credential_id: CREDENTIAL_ID,
  created_at: '2026-09-13T15:00:00.000Z',
  resolved_at: '2026-09-13T15:10:00.000Z',
  verification: {
    id: '019aa000-0000-7000-8000-000000000801',
    result: 'verified',
    method: 'official_registry_lookup',
    decided_at: '2026-09-13T15:10:00.000Z',
    valid_from: '2026-09-13T15:10:00.000Z',
    valid_to: '2026-12-13T00:00:00.000Z',
  },
}

const due: AllfitV1Schemas['CredentialRenewalDue'] = {
  credential_id: CREDENTIAL_ID,
  credential_type_code: 'academic_degree',
  credential_type_name: 'Título académico',
  credential_name: 'Fisioterapia',
  issuer: 'Universidad Nacional',
  holder_person_id: HOLDER_ID,
  holder_given_name: 'Professional',
  holder_family_name: 'Epsilon',
  last_valid_to: '2026-08-13T15:00:00.000Z',
}

const decision = {
  request_id: REQUEST_ID,
  result: 'verified',
  method: 'official_registry_lookup',
  source_authority: 'Colegio Colombiano de Fisioterapeutas',
  source_jurisdiction: 'CO',
  source_reference: 'TP-12345',
  source_status: 'vigente',
  source_checked_at: '2026-09-13T15:05:00.000Z',
  source_valid_to: '2026-12-13T00:00:00.000Z',
}

let captured: { operation: string; input: unknown }[] = []

function verificationService(
  overrides: Partial<CredentialVerificationService> = {},
): CredentialVerificationService {
  return {
    listRequests: (_verifier, input) => {
      captured.push({ operation: 'listRequests', input })
      return Promise.resolve([queued])
    },
    decide: (_verifier, input) => {
      captured.push({ operation: 'decide', input })
      return Promise.resolve({ resource: outcome, replayed: false })
    },
    listDueRenewals: (_verifier, input) => {
      captured.push({ operation: 'listDueRenewals', input })
      return Promise.resolve([due])
    },
    openRenewal: (_verifier, input) => {
      captured.push({ operation: 'openRenewal', input })
      return Promise.resolve({
        resource: {
          ...outcome,
          kind: 'renewal',
          status: 'pending',
          resolved_at: null,
          verification: null,
        },
        replayed: false,
      })
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
  verification: CredentialVerificationService = verificationService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route(
    '/backoffice/v1',
    backofficeCredentialVerificationRoutes(verification, sessions),
  )
}

function post(
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
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  if (init.idempotencyKey !== '') {
    headers.set('idempotency-key', init.idempotencyKey ?? IDEMPOTENCY_KEY)
  }
  if (init.commandId !== '') headers.set('command-id', init.commandId ?? COMMAND_ID)
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body ?? decision),
  })
}

function get(path: string, init: { cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: ORIGIN })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1${path}`, { headers })
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

describe('Backoffice credential verification API contract', () => {
  test('T-VRF-API-01 mounts every OP-IDN-011 operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.allfitOperation === 'OP-IDN-011')
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeCredentialVerificationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(4)
    expect(mounted).toEqual(contract)
  })

  test('T-VRF-API-02 mounts verification below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/verification-requests')
    expect(mounted).toContain('POST /backoffice/v1/verifications')
    expect(mounted).toContain('GET /backoffice/v1/verification-renewals')
    expect(mounted).toContain('POST /backoffice/v1/verification-renewals')
  })

  test('T-VRF-API-03 reads the queue and keeps it out of any cache', async () => {
    const response = await routes().fetch(get('/verification-requests?limit=25'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [queued] })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(captured[0]).toMatchObject({ operation: 'listRequests', input: { limit: 25 } })
  })

  test('T-VRF-API-04 refuses a malformed page or an unknown filter', async () => {
    const answers = await Promise.all(
      ['?limit=0', '?limit=201', '?limit=many', '?holder=someone'].map((query) =>
        routes().fetch(get(`/verification-requests${query}`)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-VRF-API-05 records a decision and never proposes what the server derives', async () => {
    const response = await routes().fetch(post('/verifications'))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(outcome)
    const sent = captured[0]?.input as { decision: Record<string, unknown> }
    expect(sent.decision).toMatchObject({ request_id: REQUEST_ID, result: 'verified' })
    for (const derived of ['valid_to', 'valid_from', 'policy_code', 'evidence_fingerprint']) {
      expect(sent.decision).not.toHaveProperty(derived)
    }
  })

  test('T-VRF-API-06 has no default result, so nothing is verified by omission', async () => {
    const { result: _result, ...withoutResult } = decision
    const answers = await Promise.all(
      [
        withoutResult,
        { ...decision, result: 'probably_fine' },
        { ...decision, method: 'document_upload' },
        { ...decision, source_reference: '   ' },
        { ...decision, source_checked_at: 'yesterday' },
      ].map((body) => routes().fetch(post('/verifications', { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-VRF-API-07 refuses a body that proposes its own validity, policy or evidence', async () => {
    const answers = await Promise.all(
      [
        { ...decision, valid_to: '2030-01-01T00:00:00.000Z' },
        { ...decision, policy_code: 'professional_credential.registry.v1' },
        { ...decision, evidence_fingerprint: 'deadbeef' },
      ].map((body) => routes().fetch(post('/verifications', { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-VRF-API-08 requires both command identifiers in their contract formats', async () => {
    const answers = await Promise.all([
      routes().fetch(post('/verifications', { idempotencyKey: '' })),
      routes().fetch(post('/verifications', { commandId: '' })),
      routes().fetch(post('/verifications', { commandId: IDEMPOTENCY_KEY })),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-VRF-API-09 refuses a command from another origin before doing any work', async () => {
    const response = await routes().fetch(
      post('/verifications', { origin: 'https://attacker.test' }),
    )

    expect(response.status).toBe(403)
    expect(captured).toEqual([])
  })

  test('T-VRF-API-10 marks a replayed decision instead of recording it twice', async () => {
    const response = await routes(
      verificationService({
        decide: () => Promise.resolve({ resource: outcome, replayed: true }),
      }),
    ).fetch(post('/verifications'))

    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-VRF-API-11 answers a conflict of interest as forbidden and a decided request as conflict', async () => {
    const refusal = (code: string) =>
      verificationService({
        decide: () => Promise.reject(Object.assign(new Error(code), { code })),
      })

    const conflictOfInterest = await routes(refusal('42501')).fetch(post('/verifications'))
    const alreadyDecided = await routes(refusal('55000')).fetch(post('/verifications'))
    const missing = await routes(refusal('P0002')).fetch(post('/verifications'))

    expect([conflictOfInterest.status, alreadyDecided.status, missing.status]).toEqual([
      403, 409, 404,
    ])
  })

  test('T-VRF-API-12 lists due renewals and opens one as a new request', async () => {
    const listed = await routes().fetch(get('/verification-renewals'))
    const opened = await routes().fetch(
      post('/verification-renewals', { body: { credential_id: CREDENTIAL_ID } }),
    )

    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toEqual({ items: [due] })
    expect(opened.status).toBe(201)
    await expect(opened.json()).resolves.toMatchObject({ kind: 'renewal', status: 'pending' })
    expect(captured.map((entry) => entry.operation)).toEqual(['listDueRenewals', 'openRenewal'])
  })

  test('T-VRF-API-13 refuses a renewal for anything but one credential', async () => {
    const answers = await Promise.all(
      [
        {},
        { credential_id: 'not-a-credential' },
        { credential_id: CREDENTIAL_ID, extend: true },
      ].map((body) => routes().fetch(post('/verification-renewals', { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-VRF-API-14 answers unauthenticated without a session and when it ended', async () => {
    const missing = await routes().fetch(get('/verification-requests', { cookie: false }))
    const ended = await routes(
      verificationService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(get('/verification-requests'))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
