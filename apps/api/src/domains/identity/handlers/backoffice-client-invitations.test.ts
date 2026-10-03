import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import type { ClientInvitationResendService } from '../application/client-invitation-resends.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'
import { backofficeClientInvitationRoutes } from './backoffice-client-invitations.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019b3000-0000-7000-8000-000000000002'
const ACTOR_SESSION_ID = '019b3000-0000-7000-8000-000000000042'
const ORGANIZATION_ID = '019b3000-0000-7000-8000-000000000301'
const INVITATION_ID = '019b3000-0000-7000-8000-000000000502'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000002'
const COMMAND_ID = '019b3000-0000-7000-8000-000000000602'

const invitation: AllfitV1Schemas['BackofficeClientInvitation'] = {
  invitation_id: INVITATION_ID,
  state: 'expired',
  scope_codes: ['health_context', 'relationship_training'],
  contact_hint: 'l***@example.test',
  created_at: '2026-09-24T12:00:00.000Z',
  expires_at: '2026-10-01T12:00:00.000Z',
  issued_by: 'member',
  reissues_invitation_id: null,
  resendable: true,
  last_resent_at: null,
}

const reissued: AllfitV1Schemas['BackofficeClientInvitationResend'] = {
  ...invitation,
  invitation_id: COMMAND_ID,
  state: 'pending',
  issued_by: 'allfit',
  reissues_invitation_id: INVITATION_ID,
  outcome: 'reissued',
}

let captured: { operation: string; resender: unknown; input: unknown }[] = []

function resendService(
  overrides: Partial<ClientInvitationResendService> = {},
): ClientInvitationResendService {
  return {
    list: (resender, input) => {
      captured.push({ operation: 'list', resender, input })
      return Promise.resolve({
        organization_id: ORGANIZATION_ID,
        items: [invitation],
        truncated: false,
      })
    },
    resend: (resender, input) => {
      captured.push({ operation: 'resend', resender, input })
      return Promise.resolve({ resource: reissued, replayed: false })
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
  service: ClientInvitationResendService = resendService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeClientInvitationRoutes(service, sessions))
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

function resendRequest(
  overrides: {
    origin?: string
    cookie?: boolean
    headers?: Record<string, string>
    body?: string
    invitationId?: string
  } = {},
): Request {
  return request(
    `/organizations/${ORGANIZATION_ID}/client-invitations/${overrides.invitationId ?? INVITATION_ID}/resends`,
    {
      method: 'POST',
      ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
      ...(overrides.cookie === undefined ? {} : { cookie: overrides.cookie }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': IDEMPOTENCY_KEY,
        'command-id': COMMAND_ID,
        ...overrides.headers,
      },
      body: overrides.body ?? '{}',
    },
  )
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

describe('Backoffice client invitation resend API contract', () => {
  test('T-IDN-CLIENT-RESEND-API-01 mounts the read and OP-IDN-051 with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) =>
        ['NEW-IDN-CLIENT-RESEND', 'OP-IDN-051'].includes(operation.allfitOperation),
      )
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeClientInvitationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(2)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-CLIENT-RESEND-API-02 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/organizations/:organizationId/client-invitations')
    expect(mounted).toContain(
      'POST /backoffice/v1/organizations/:organizationId/client-invitations/:invitationId/resends',
    )
  })

  test('T-IDN-CLIENT-RESEND-API-03 lists a gym’s client invitations with what each one asked for', async () => {
    const response = await routes().fetch(
      request(`/organizations/${ORGANIZATION_ID}/client-invitations`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      organization_id: ORGANIZATION_ID,
      items: [invitation],
      truncated: false,
    })
    expect(captured[0]?.resender).toEqual({
      actorPersonId: ACTOR_PERSON_ID,
      actorSessionId: ACTOR_SESSION_ID,
    })
    expect(captured[0]?.input).toMatchObject({ organizationId: ORGANIZATION_ID })
  })

  test('T-IDN-CLIENT-RESEND-API-04 refuses a malformed gym or any query before reaching the service', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/organizations/not-a-uuid/client-invitations')),
      routes().fetch(request(`/organizations/${ORGANIZATION_ID}/client-invitations?state=pending`)),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-CLIENT-RESEND-API-05 resends with the command and says when it replays', async () => {
    const first = await routes().fetch(resendRequest())
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual(reissued)
    expect(first.headers.get('idempotent-replay')).toBeNull()
    expect(captured[0]?.input).toMatchObject({
      organizationId: ORGANIZATION_ID,
      invitationId: INVITATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
    })

    const replay = await routes(
      resendService({ resend: async () => ({ resource: reissued, replayed: true }) }),
    ).fetch(resendRequest())
    expect(replay.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-IDN-CLIENT-RESEND-API-06 takes no contact, gym or offer from the client', async () => {
    const answers = await Promise.all([
      routes().fetch(resendRequest({ body: '{"contact":"someone@example.test"}' })),
      routes().fetch(resendRequest({ body: '{"scope_codes":["health_context"]}' })),
      routes().fetch(resendRequest({ headers: { 'content-type': 'text/plain' } })),
      routes().fetch(resendRequest({ origin: 'https://attacker.test' })),
      routes().fetch(resendRequest({ headers: { 'idempotency-key': 'not-a-key' } })),
      routes().fetch(resendRequest({ invitationId: 'a0000000-0000-4000-8000-000000000001' })),
    ])

    expect(answers.map((response) => response.status)).toEqual([422, 422, 415, 403, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-CLIENT-RESEND-API-07 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['55000', 409],
      // The reissue whose offer did not match the original's.
      ['23514', 409],
      ['22023', 422],
      ['P0001', 429],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          resendService({
            resend: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(resendRequest()),
      ),
    )
    const broken = await routes(
      resendService({ resend: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(resendRequest())

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[5]?.headers.get('retry-after')).toBe('3600')
    expect(broken.status).toBe(503)
  })

  test('T-IDN-CLIENT-RESEND-API-08 never reaches the service without a session that still resolves', async () => {
    const missing = await routes().fetch(resendRequest({ cookie: false }))
    const ended = await routes(
      resendService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request(`/organizations/${ORGANIZATION_ID}/client-invitations`))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
