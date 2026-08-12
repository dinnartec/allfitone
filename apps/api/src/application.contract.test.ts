import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'

import { createApp } from './application.js'

type Route = { method: string; path: string }

const HTTP_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'])

function routeKey(route: Route) {
  const canonicalPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  return `${route.method.toUpperCase()} ${canonicalPath}`
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
