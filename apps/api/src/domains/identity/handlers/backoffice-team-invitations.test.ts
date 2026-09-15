import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import type { TeamInvitationResendService } from '../application/team-invitation-resends.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'
import { backofficeTeamInvitationRoutes } from './backoffice-team-invitations.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019af000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019af000-0000-7000-8000-000000000043'
const ORGANIZATION_ID = '019af000-0000-7000-8000-000000000301'
const INVITATION_ID = '019af000-0000-7000-8000-000000000502'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000001'
const COMMAND_ID = '019af000-0000-7000-8000-000000000601'

const invitation: AllfitV1Schemas['BackofficeTeamInvitation'] = {
  invitation_id: INVITATION_ID,
  state: 'expired',
  proposed_role_code: 'staff',
  contact_hint: 'e***@example.test',
  created_at: '2026-09-06T12:00:00.000Z',
  expires_at: '2026-09-13T12:00:00.000Z',
  issued_by: 'member',
  reissues_invitation_id: null,
  resendable: true,
  last_resent_at: null,
}

const reissued: AllfitV1Schemas['BackofficeTeamInvitationResend'] = {
  ...invitation,
  invitation_id: COMMAND_ID,
  state: 'pending',
  issued_by: 'allfit',
  reissues_invitation_id: INVITATION_ID,
  outcome: 'reissued',
}

let captured: { operation: string; resender: unknown; input: unknown }[] = []

function resendService(
  overrides: Partial<TeamInvitationResendService> = {},
): TeamInvitationResendService {
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
  service: TeamInvitationResendService = resendService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeTeamInvitationRoutes(service, sessions))
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
    `/organizations/${ORGANIZATION_ID}/team-invitations/${overrides.invitationId ?? INVITATION_ID}/resends`,
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

describe('Backoffice team invitation resend API contract', () => {
  test('T-IDN-RESEND-API-01 mounts NEW-IDN-RESEND and OP-IDN-045 with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => ['NEW-IDN-RESEND', 'OP-IDN-045'].includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeTeamInvitationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(2)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-RESEND-API-02 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/organizations/:organizationId/team-invitations')
    expect(mounted).toContain(
      'POST /backoffice/v1/organizations/:organizationId/team-invitations/:invitationId/resends',
    )
  })

  test('T-IDN-RESEND-API-03 lists a gym’s invitations as the operator and stores nothing', async () => {
    const response = await routes().fetch(
      request(`/organizations/${ORGANIZATION_ID}/team-invitations`),
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

  test('T-IDN-RESEND-API-04 refuses a malformed gym or any query before reaching the service', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/organizations/not-a-uuid/team-invitations')),
      routes().fetch(request(`/organizations/${ORGANIZATION_ID}/team-invitations?status=pending`)),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-RESEND-API-05 resends with the command and says when it replays', async () => {
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

  test('T-IDN-RESEND-API-06 takes no contact, role or gym from the client and refuses a malformed command', async () => {
    const answers = await Promise.all([
      routes().fetch(resendRequest({ body: '{"contact":"someone@example.test"}' })),
      routes().fetch(resendRequest({ body: '{"proposed_role_code":"admin"}' })),
      routes().fetch(resendRequest({ headers: { 'content-type': 'text/plain' } })),
      routes().fetch(resendRequest({ origin: 'https://attacker.test' })),
      routes().fetch(resendRequest({ headers: { 'idempotency-key': 'not-a-key' } })),
      routes().fetch(resendRequest({ invitationId: 'a0000000-0000-4000-8000-000000000001' })),
    ])

    expect(answers.map((response) => response.status)).toEqual([422, 422, 415, 403, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-RESEND-API-07 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['55000', 409],
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
    expect(answers[4]?.headers.get('retry-after')).toBe('3600')
    expect(broken.status).toBe(503)
  })

  test('T-IDN-RESEND-API-08 never reaches the service without a session that still resolves', async () => {
    const missing = await routes().fetch(resendRequest({ cookie: false }))
    const ended = await routes(
      resendService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request(`/organizations/${ORGANIZATION_ID}/team-invitations`))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
