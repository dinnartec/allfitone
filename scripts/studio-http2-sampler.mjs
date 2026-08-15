import { connect, constants } from 'node:http2'
import { URL } from 'node:url'

import { vercelExecutionRegion } from './vercel-region.mjs'

const {
  HTTP2_HEADER_ACCEPT,
  HTTP2_HEADER_COOKIE,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_ORIGIN,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_STATUS,
  NGHTTP2_CANCEL,
} = constants

export function createStudioHttp2Sampler({ apiUrl, sessionCookie, studioOrigin }) {
  const api = new URL(apiUrl)
  const basePath = api.pathname === '/' ? '' : api.pathname.replace(/\/$/, '')
  let session

  function activeSession() {
    if (session && !session.closed && !session.destroyed) return session

    const nextSession = connect(api.origin)
    nextSession.on('error', () => {})
    nextSession.on('close', () => {
      if (session === nextSession) session = undefined
    })
    session = nextSession
    return nextSession
  }

  async function sample(path) {
    const startedAt = globalThis.performance.now()
    const headers = await request(activeSession(), `${basePath}${path}`, {
      [HTTP2_HEADER_ACCEPT]: 'application/json',
      [HTTP2_HEADER_COOKIE]: sessionCookie,
      [HTTP2_HEADER_ORIGIN]: studioOrigin,
    })
    const durationMs = globalThis.performance.now() - startedAt
    const serverTiming = headerValue(headers['server-timing'])

    return {
      status: Number(headers[HTTP2_HEADER_STATUS]),
      durationMs,
      usedWorkos: /(?:^|,)\s*workos-refresh;dur=/.test(serverTiming ?? ''),
      region: vercelExecutionRegion(headerValue(headers['x-vercel-id'])),
    }
  }

  async function close() {
    const currentSession = session
    session = undefined
    if (!currentSession || currentSession.closed || currentSession.destroyed) return
    await new Promise((resolve) => currentSession.close(resolve))
  }

  return { sample, close }
}

function request(session, path, extraHeaders) {
  return new Promise((resolve, reject) => {
    const stream = session.request({
      [HTTP2_HEADER_METHOD]: 'GET',
      [HTTP2_HEADER_PATH]: path,
      ...extraHeaders,
    })
    let responseHeaders
    let settled = false

    stream.setTimeout(30_000, () => {
      stream.close(NGHTTP2_CANCEL)
      finish(new Error(`Studio latency request timed out: ${path}`))
    })
    stream.on('response', (headers) => {
      responseHeaders = headers
    })
    stream.on('data', () => {})
    stream.on('end', () => finish(undefined, responseHeaders))
    stream.on('error', (error) => finish(error))

    function finish(error, headers) {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (!headers) reject(new Error(`Studio latency response had no headers: ${path}`))
      else resolve(headers)
    }
  })
}

function headerValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined ? undefined : String(value)
}
