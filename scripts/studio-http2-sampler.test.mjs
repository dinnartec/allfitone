import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http2'

import { assertStudioBenchmarkAccess, createStudioHttp2Sampler } from './studio-http2-sampler.mjs'

describe('createStudioHttp2Sampler', () => {
  let apiUrl
  let sampler
  let server
  const requests = []
  let sessionCount = 0

  beforeAll(async () => {
    server = createServer()
    server.on('session', () => {
      sessionCount += 1
    })
    server.on('stream', (stream, headers) => {
      requests.push(headers)
      stream.respond({
        ':status': 200,
        'server-timing': 'session-db;dur=12.5, workos-refresh;dur=40',
        'x-vercel-id': 'iad1::pdx1::request-id',
      })
      stream.end('{}')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    apiUrl = `http://127.0.0.1:${address.port}/api`
    sampler = createStudioHttp2Sampler({
      apiUrl,
      sessionCookie: 'allfit_studio_session=test-cookie',
      studioOrigin: 'https://studio.allfit.one',
    })
  })

  afterAll(async () => {
    await sampler.close()
    await new Promise((resolve) => server.close(resolve))
  })

  test('reuses HTTP/2 while preserving Studio request headers and API base path', async () => {
    const first = await sampler.sample('/studio/v1/session')
    const second = await sampler.sample('/studio/v1/entry-context')

    expect(first.status).toBe(200)
    expect(first.usedWorkos).toBe(true)
    expect(first.region).toBe('pdx1')
    expect(second.status).toBe(200)
    expect(requests.map((headers) => headers[':path'])).toEqual([
      '/api/studio/v1/session',
      '/api/studio/v1/entry-context',
    ])
    expect(requests[0].cookie).toBe('allfit_studio_session=test-cookie')
    expect(requests[0].origin).toBe('https://studio.allfit.one')
    expect(sessionCount).toBe(1)
  })
})

describe('assertStudioBenchmarkAccess', () => {
  test('fails immediately when the technical session is no longer usable', () => {
    expect(() => assertStudioBenchmarkAccess('session', { status: 401 })).toThrow(
      'Studio technical session is no longer valid while measuring session',
    )
    expect(() => assertStudioBenchmarkAccess('organization-roles', { status: 403 })).toThrow(
      'Studio technical account is forbidden while measuring organization-roles',
    )
  })

  test('leaves other statuses for the benchmark error count', () => {
    expect(() => assertStudioBenchmarkAccess('session', { status: 200 })).not.toThrow()
    expect(() => assertStudioBenchmarkAccess('session', { status: 503 })).not.toThrow()
  })
})
