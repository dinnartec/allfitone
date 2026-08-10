import { afterEach, describe, expect, test } from 'bun:test'

import { StudioApiError, newCommand, studioApi } from './studio-api.js'

const originalFetch = globalThis.fetch
const originalSessionStorage = globalThis.sessionStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: originalSessionStorage,
  })
})

test('uses UUIDv4 for HTTP idempotency and UUIDv7 for durable command identity', () => {
  const command = newCommand()
  expect(command.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(command.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

describe('professional profile API', () => {
  test('uses the personal profile routes and HTTP methods from the contract', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return Response.json({})
    }) as typeof fetch
    const command = newCommand()
    const profile = {
      headline: 'Entrenador de fuerza',
      bio: 'Acompañamiento profesional.',
      practice_started_year: 2020,
      specialty_codes: ['strength_conditioning'],
    }
    const credential = {
      credential_type_code: 'professional_certification',
      issuer: 'Allfit Academy',
      name: 'Fuerza aplicada',
    }

    await studioApi.me()
    await studioApi.updateProfessionalProfile(profile, command)
    await studioApi.declareProfessionalCredential(credential, command)
    await studioApi.retireProfessionalCredential('credential-1', command)

    expect(calls.map(({ url, init }) => [new URL(url).pathname, init.method ?? 'GET'])).toEqual([
      ['/studio/v1/me', 'GET'],
      ['/studio/v1/me/professional-profile', 'PUT'],
      ['/studio/v1/me/professional-credentials', 'POST'],
      ['/studio/v1/me/professional-credentials/credential-1/retirement', 'POST'],
    ])
    expect(calls.every(({ init }) => init.credentials === 'include')).toBe(true)
    expect(calls[1]?.init.body).toBe(JSON.stringify(profile))
    expect(calls[2]?.init.body).toBe(JSON.stringify(credential))
    expect(calls[3]?.init.body).toBeUndefined()
  })

  test('sends exact credential revision route, body, cookies and command headers', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json(credentialResponse())
    }) as typeof fetch

    const command = newCommand()
    await studioApi.reviseProfessionalCredential(
      'credential-1',
      {
        credential_type_code: 'professional_certification',
        issuer: 'Allfit Academy',
        name: 'Fuerza aplicada',
      },
      command,
    )

    expect(capturedUrl).toEndWith('/studio/v1/me/professional-credentials/credential-1/revisions')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.credentials).toBe('include')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('Idempotency-Key')).toBe(command.idempotencyKey)
    expect(headers.get('Command-Id')).toBe(command.commandId)
    expect(capturedInit?.body).toBe(
      JSON.stringify({
        credential_type_code: 'professional_certification',
        issuer: 'Allfit Academy',
        name: 'Fuerza aplicada',
      }),
    )
  })

  test('revalidates cached catalogs with ETag and reuses the payload on 304', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: memoryStorage(),
    })
    const requests: RequestInit[] = []
    globalThis.fetch = (async (_input, init) => {
      requests.push(init ?? {})
      if (requests.length === 1) {
        return Response.json(
          {
            items: [
              { code: 'personal_training', name: 'Entrenamiento personal', description: null },
            ],
          },
          { headers: { ETag: '"specialties-v1"' } },
        )
      }
      return new Response(null, { status: 304 })
    }) as typeof fetch

    const first = await studioApi.professionalSpecialties()
    const second = await studioApi.professionalSpecialties()

    expect(second).toEqual(first)
    expect(new Headers(requests[0]?.headers).has('If-None-Match')).toBe(false)
    expect(new Headers(requests[1]?.headers).get('If-None-Match')).toBe('"specialties-v1"')
  })

  test('preserves stable error codes and details', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: { code: 'registration-incomplete', detail: 'Complete registration' } },
        { status: 403 },
      )) as unknown as typeof fetch

    const error = await studioApi.me().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(StudioApiError)
    if (error instanceof StudioApiError) {
      expect(error.status).toBe(403)
      expect(error.code).toBe('registration-incomplete')
      expect(error.detail).toBe('Complete registration')
    }
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function credentialResponse() {
  return {
    id: 'credential-2',
    credential_type_code: 'professional_certification',
    credential_type_name: 'Certificación profesional',
    issuer: 'Allfit Academy',
    name: 'Fuerza aplicada',
    identifier: null,
    issued_on: null,
    expires_on: null,
    verification_url: null,
    status: 'active',
    supersedes_credential_id: 'credential-1',
    created_at: '2026-08-10T12:00:00.000Z',
    retired_at: null,
    verification: {
      state: 'unverified',
      valid_from: null,
      valid_to: null,
      effective: false,
    },
  }
}
