import { afterEach, describe, expect, test } from 'bun:test'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  parseRetryAfter,
} from './backoffice-api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('uses UUIDv4 for retries and UUIDv7 for the durable verification command', () => {
  const command = newBackofficeCommand()
  expect(command.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(command.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

describe('Backoffice API client', () => {
  test('sends cookies and exact command headers to the TOTP endpoint', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const command = newBackofficeCommand()

    await backofficeApi.verifyTotp('123456', command)

    expect(new URL(capturedUrl).pathname).toBe('/backoffice/v1/auth/totp/verification')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.credentials).toBe('include')
    expect(capturedInit?.body).toBe(JSON.stringify({ code: '123456' }))
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('Idempotency-Key')).toBe(command.idempotencyKey)
    expect(headers.get('Command-Id')).toBe(command.commandId)
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  test('keeps password-reset responses uniform and uses the requested email only in the body', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (_input, init) => {
      capturedInit = init
      return new Response(null, { status: 202 })
    }) as typeof fetch

    await backofficeApi.passwordReset('operator@example.test')

    expect(capturedInit?.credentials).toBe('include')
    expect(capturedInit?.body).toBe(JSON.stringify({ email: 'operator@example.test' }))
  })

  test('normalizes rate limits without exposing response details', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: { code: 'rate-limited', detail: 'internal limiter detail' } },
        { status: 429, headers: { 'Retry-After': '12' } },
      )) as unknown as typeof fetch

    const error = await backofficeApi
      .password('operator@example.test', 'secret')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BackofficeApiError)
    if (error instanceof BackofficeApiError) {
      expect(error.status).toBe(429)
      expect(error.code).toBe('rate-limited')
      expect(error.retryAfterMs).toBe(12_000)
      expect(error).not.toHaveProperty('detail')
    }
  })

  test('turns transport failures into a PII-free network error', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('failed to fetch operator@example.test')
    }) as unknown as typeof fetch

    const error = await backofficeApi.session().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BackofficeNetworkError)
    expect(String(error)).not.toContain('operator@example.test')
  })
})

test('parses both Retry-After forms', () => {
  const now = Date.parse('2026-08-12T12:00:00.000Z')
  expect(parseRetryAfter('3', now)).toBe(3_000)
  expect(parseRetryAfter('Wed, 12 Aug 2026 12:00:05 GMT', now)).toBe(5_000)
  expect(parseRetryAfter('invalid', now)).toBeUndefined()
})
