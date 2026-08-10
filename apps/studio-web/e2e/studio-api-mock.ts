import type { Page, Request, Route } from '@playwright/test'

const API_ORIGIN = 'http://127.0.0.1:8080'
const STUDIO_ORIGIN = 'http://127.0.0.1:3101'

export interface MockRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

export interface MockResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export interface StudioApiFixture {
  session: unknown
  memberships: unknown[]
  organizationTypes: unknown[]
  me: { profile: Record<string, unknown> | null; memberships: unknown[] }
  specialties: Array<{ code: string; name: string; description: string | null }>
  credentialTypes: Array<{ code: string; name: string; description: string | null }>
  signedOut: boolean
  requests: MockRequest[]
  intercept?: (
    request: MockRequest,
    fixture: StudioApiFixture,
  ) => MockResponse | undefined | Promise<MockResponse | undefined>
}

export const activeMembership = {
  membership_id: '01991600-1000-7000-8000-000000000001',
  organization_id: '01991600-1000-7000-8000-000000000002',
  display_name: 'Allfit Gym',
  type_code: 'gym',
  status: 'active',
  joined_at: '2025-01-01T00:00:00.000Z',
  ended_at: null,
  roles: ['owner'],
}

export const secondActiveMembership = {
  membership_id: '01991600-1000-7000-8000-000000000003',
  organization_id: '01991600-1000-7000-8000-000000000004',
  display_name: 'Movimiento Studio',
  type_code: 'studio',
  status: 'active',
  joined_at: '2025-02-01T00:00:00.000Z',
  ended_at: null,
  roles: ['coach'],
}

export const terminatedMembership = {
  membership_id: '01991600-1000-7000-8000-000000000005',
  organization_id: '01991600-1000-7000-8000-000000000006',
  display_name: 'Legacy Studio',
  type_code: 'studio',
  status: 'terminated',
  joined_at: '2023-01-01T00:00:00.000Z',
  ended_at: '2025-06-01T00:00:00.000Z',
  roles: ['staff'],
}

export const professionalProfile = {
  id: '01991600-2000-7000-8000-000000000001',
  headline: 'Entrenadora de fuerza',
  bio: 'Acompaño procesos sostenibles de fuerza y movilidad.',
  practice_started_year: 2018,
  experience_years: 8,
  specialties: [
    {
      code: 'strength_conditioning',
      name: 'Fuerza y acondicionamiento',
      description: null,
    },
  ],
  credentials: [],
  created_at: '2026-08-09T12:00:00.000Z',
  updated_at: '2026-08-09T12:00:00.000Z',
}

export const professionalCredential = {
  id: '01991600-3000-7000-8000-000000000001',
  credential_type_code: 'professional_certification',
  credential_type_name: 'Certificación profesional',
  issuer: 'NSCA',
  name: 'Fuerza aplicada',
  identifier: 'CERT-001',
  issued_on: '2024-01-01',
  expires_on: '2028-01-01',
  verification_url: 'https://example.test/cert-001',
  status: 'active',
  supersedes_credential_id: null,
  created_at: '2026-08-09T12:00:00.000Z',
  retired_at: null,
  verification: {
    state: 'unverified',
    valid_from: null,
    valid_to: null,
    effective: false,
  },
}

export function createStudioApiFixture(
  overrides: Partial<StudioApiFixture> = {},
): StudioApiFixture {
  return {
    session: {
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    },
    memberships: [],
    organizationTypes: [
      { code: 'professional_practice', name: 'Profesional independiente', description: null },
      { code: 'gym', name: 'Gimnasio', description: null },
      { code: 'studio', name: 'Estudio', description: null },
    ],
    me: { profile: null, memberships: [] },
    specialties: [
      { code: 'personal_training', name: 'Entrenamiento personal', description: null },
      {
        code: 'strength_conditioning',
        name: 'Fuerza y acondicionamiento',
        description: null,
      },
    ],
    credentialTypes: [
      { code: 'academic_degree', name: 'Título académico', description: null },
      {
        code: 'professional_certification',
        name: 'Certificación profesional',
        description: null,
      },
    ],
    signedOut: false,
    requests: [],
    ...overrides,
  }
}

export async function installStudioApiMock(page: Page, fixture: StudioApiFixture): Promise<void> {
  await page.route(`${API_ORIGIN}/studio/v1/**`, async (route) => {
    const request = toMockRequest(route.request())
    if (request.method === 'OPTIONS') {
      await fulfill(route, { status: 204 })
      return
    }

    fixture.requests.push(request)
    const intercepted = await fixture.intercept?.(request, fixture)
    if (intercepted) {
      await fulfill(route, intercepted)
      return
    }

    const response = defaultResponse(request, fixture)
    await fulfill(route, response ?? { status: 500, body: { error: { code: 'unmocked-route' } } })
  })
}

function defaultResponse(
  request: MockRequest,
  fixture: StudioApiFixture,
): MockResponse | undefined {
  if (request.method === 'GET' && request.path === '/studio/v1/session') {
    if (fixture.signedOut) return { status: 401, body: error('unauthenticated') }
    return { status: 200, body: fixture.session }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/auth/logout') {
    fixture.signedOut = true
    return { status: 303, headers: { Location: `${STUDIO_ORIGIN}/` } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/me/memberships') {
    return { status: 200, body: { items: fixture.memberships } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/organization-types') {
    return { status: 200, body: { items: fixture.organizationTypes } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/me') {
    return { status: 200, body: fixture.me }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/professional-specialties') {
    return {
      status: 200,
      body: { items: fixture.specialties },
      headers: { ETag: '"specialties-v1"' },
    }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/professional-credential-types') {
    return {
      status: 200,
      body: { items: fixture.credentialTypes },
      headers: { ETag: '"credential-types-v1"' },
    }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/onboarding-attempts') {
    return {
      status: 201,
      body: {
        id: '01991600-4000-7000-8000-000000000001',
        status: 'open',
        eligibility_status: 'unknown',
        expires_at: '2026-08-11T00:00:00.000Z',
      },
    }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/organizations') {
    return {
      status: 201,
      body: {
        id: '01991600-5000-7000-8000-000000000001',
        display_name: 'Nuevo espacio',
        type_code: 'gym',
        status: 'active',
        membership_id: '01991600-5000-7000-8000-000000000002',
        role: 'owner',
      },
    }
  }
  if (request.method === 'PUT' && request.path === '/studio/v1/me/professional-profile') {
    const body = request.body as {
      headline: string
      bio: string
      practice_started_year: number
      specialty_codes: string[]
    }
    const existing = fixture.me.profile
    const profile = {
      ...professionalProfile,
      ...existing,
      headline: body.headline,
      bio: body.bio,
      practice_started_year: body.practice_started_year,
      experience_years: new Date().getUTCFullYear() - body.practice_started_year,
      specialties: fixture.specialties.filter((item) => body.specialty_codes.includes(item.code)),
      credentials: existing?.credentials ?? [],
      updated_at: '2026-08-10T12:00:00.000Z',
    }
    fixture.me.profile = profile
    return { status: 200, body: profile }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/me/professional-credentials') {
    const credential = credentialFromRequest(request, professionalCredential.id)
    appendCredential(fixture, credential)
    return { status: 201, body: credential }
  }
  if (
    request.method === 'POST' &&
    request.path.endsWith('/revisions') &&
    request.path.startsWith('/studio/v1/me/professional-credentials/')
  ) {
    const credentialId = request.path.split('/').at(-2) ?? ''
    const successor = credentialFromRequest(
      request,
      '01991600-3000-7000-8000-000000000002',
      credentialId,
    )
    replaceWithRevision(fixture, credentialId, successor)
    return { status: 201, body: successor }
  }
  if (
    request.method === 'POST' &&
    request.path.endsWith('/retirement') &&
    request.path.startsWith('/studio/v1/me/professional-credentials/')
  ) {
    const credentialId = request.path.split('/').at(-2) ?? ''
    const retired = retireCredential(fixture, credentialId)
    return retired ? { status: 200, body: retired } : { status: 404, body: error('not-found') }
  }
  return undefined
}

function credentialFromRequest(request: MockRequest, id: string, supersedes: string | null = null) {
  const body = request.body as Record<string, unknown>
  const type = body.credential_type_code
  return {
    ...professionalCredential,
    ...body,
    id,
    credential_type_name:
      type === 'academic_degree' ? 'Título académico' : 'Certificación profesional',
    supersedes_credential_id: supersedes,
  }
}

function credentials(fixture: StudioApiFixture): Array<Record<string, unknown>> {
  const value = fixture.me.profile?.credentials
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function appendCredential(fixture: StudioApiFixture, credential: Record<string, unknown>): void {
  if (fixture.me.profile) fixture.me.profile.credentials = [credential, ...credentials(fixture)]
}

function replaceWithRevision(
  fixture: StudioApiFixture,
  previousId: string,
  successor: Record<string, unknown>,
): void {
  if (!fixture.me.profile) return
  const revised = credentials(fixture).map((credential) =>
    credential.id === previousId
      ? { ...credential, status: 'retired', retired_at: '2026-08-10T12:00:00.000Z' }
      : credential,
  )
  fixture.me.profile.credentials = [successor, ...revised]
}

function retireCredential(
  fixture: StudioApiFixture,
  credentialId: string,
): Record<string, unknown> | undefined {
  let retired: Record<string, unknown> | undefined
  if (!fixture.me.profile) return undefined
  fixture.me.profile.credentials = credentials(fixture).map((credential) => {
    if (credential.id !== credentialId) return credential
    retired = { ...credential, status: 'retired', retired_at: '2026-08-10T12:00:00.000Z' }
    return retired
  })
  return retired
}

function toMockRequest(request: Request): MockRequest {
  return {
    method: request.method(),
    path: new URL(request.url()).pathname,
    headers: request.headers(),
    body: parseBody(request),
  }
}

function parseBody(request: Request): unknown {
  const body = request.postData()
  if (!body) return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function fulfill(route: Route, response: MockResponse): Promise<void> {
  const hasBody = response.body !== undefined
  await route.fulfill({
    status: response.status,
    body: hasBody ? JSON.stringify(response.body) : '',
    headers: {
      'Access-Control-Allow-Origin': STUDIO_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Command-Id, If-None-Match',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...response.headers,
    },
  })
}

export function error(code: string, detail?: string): { error: { code: string; detail?: string } } {
  return { error: { code, ...(detail ? { detail } : {}) } }
}
