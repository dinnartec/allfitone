import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'

import { createApp } from './application.js'

type Route = { method: string; path: string }
type Handled = Route & { handler: { length: number } }

const HTTP_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'])

function routeKey(route: Route) {
  const canonicalPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  return `${route.method.toUpperCase()} ${canonicalPath}`
}

// A terminal handler takes the context alone; route-level middleware takes a next as
// well. Only the first kind answers, so only the first kind may appear twice.
function collidingRoutes(routes: readonly Handled[]) {
  const answered = new Map<string, number>()
  for (const { method, path, handler } of routes) {
    if (!HTTP_METHODS.has(method.toUpperCase()) || handler.length !== 1) continue
    const key = routeKey({ method, path })
    answered.set(key, (answered.get(key) ?? 0) + 1)
  }
  return [...answered].filter(([, count]) => count > 1).map(([key]) => key)
}

function contractDrift(implementedRoutes: readonly Route[], excludedRoutes: readonly Route[]) {
  const stableRoutes = new Set(allfitV1ContractManifest.operations.map(routeKey))
  const exclusions = new Set(excludedRoutes.map(routeKey))
  const implemented = new Set(
    implementedRoutes.filter(({ method }) => HTTP_METHODS.has(method.toUpperCase())).map(routeKey),
  )

  return {
    undocumented: [...implemented].filter(
      (route) => !stableRoutes.has(route) && !exclusions.has(route),
    ),
    staleExclusions: [...exclusions].filter((route) => !implemented.has(route)),
  }
}

describe('OpenAPI route gate', () => {
  test('covers every implemented Hono route and keeps every exclusion live', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
    const routes = createApp().routes.map(({ method, path }) => ({ method, path }))

    expect(contractDrift(routes, allfitV1ContractManifest.exclusions)).toEqual({
      undocumented: [],
      staleExclusions: [],
    })
  })

  // Two routers mounted on the same prefix can both claim a path. Hono answers with
  // whichever registered first, so the other becomes unreachable without failing anything.
  test('leaves no path answered by two handlers', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'

    expect(collidingRoutes(createApp().routes)).toEqual([])
  })

  test('rejects a path two handlers answer and ignores route-level middleware', () => {
    const answer = (c: unknown) => c
    const middleware = (c: unknown, next: unknown) => [c, next]

    expect(
      collidingRoutes([
        { method: 'POST', path: '/twice', handler: answer },
        { method: 'POST', path: '/twice', handler: answer },
        { method: 'POST', path: '/guarded', handler: middleware },
        { method: 'POST', path: '/guarded', handler: answer },
      ]),
    ).toEqual(['POST /twice'])
  })

  test('rejects an implemented route absent from both OpenAPI and exclusions', () => {
    const routes = [{ method: 'GET', path: '/not-contracted' }]

    expect(contractDrift(routes, [])).toEqual({
      undocumented: ['GET /not-contracted'],
      staleExclusions: [],
    })
  })

  test('rejects an exclusion after its implementation disappears', () => {
    const exclusions = [{ method: 'GET', path: '/removed-route' }]

    expect(contractDrift([], exclusions)).toEqual({
      undocumented: [],
      staleExclusions: ['GET /removed-route'],
    })
  })
})
