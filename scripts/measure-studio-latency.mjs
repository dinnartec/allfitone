const apiUrl = requiredEnvironment('STUDIO_API_URL').replace(/\/$/, '')
const sessionCookie = requiredEnvironment('STUDIO_SESSION_COOKIE')
const organizationId = process.env.STUDIO_TECHNICAL_ORGANIZATION_ID
const expectedRegion = process.env.STUDIO_EXPECTED_VERCEL_REGION
const samples = positiveInteger(process.env.STUDIO_LATENCY_SAMPLES, 200)
const warmups = positiveInteger(process.env.STUDIO_LATENCY_WARMUPS, 20)
const idleCycles = positiveInteger(process.env.STUDIO_LATENCY_IDLE_CYCLES, 10)
const idleMs = positiveInteger(process.env.STUDIO_LATENCY_IDLE_MS, 21_000)

const endpoints = [
  { name: 'session', path: '/studio/v1/session' },
  { name: 'entry-context', path: '/studio/v1/entry-context' },
  { name: 'my-memberships', path: '/studio/v1/me/memberships' },
  ...(organizationId
    ? [
        {
          name: 'organization-memberships',
          path: `/studio/v1/organizations/${organizationId}/memberships?limit=50`,
        },
        {
          name: 'organization-invitations',
          path: `/studio/v1/organizations/${organizationId}/invitations?limit=50`,
        },
        {
          name: 'organization-roles',
          path: `/studio/v1/organizations/${organizationId}/roles`,
        },
      ]
    : []),
]

let failed = false
const observedRegions = new Set()
for (const endpoint of endpoints) {
  for (let index = 0; index < warmups; index += 1) await sample(endpoint.path)

  const normalDurations = []
  const workosDurations = []
  let errors = 0
  for (let index = 0; index < samples; index += 1) {
    const result = await sample(endpoint.path)
    if (result.region) observedRegions.add(result.region)
    if (result.status < 200 || result.status >= 400) errors += 1
    const target = result.usedWorkos ? workosDurations : normalDurations
    target.push(result.durationMs)
  }

  const summary = summarize(normalDurations)
  const accepted = errors === 0 && summary.p95 <= 500 && summary.p99 <= 800 && summary.max <= 1_000
  failed ||= !accepted
  console.log(
    JSON.stringify({
      endpoint: endpoint.name,
      samples: normalDurations.length,
      workos_samples: workosDurations.length,
      errors,
      ...summary,
      workos: { samples: workosDurations.length, ...summarize(workosDurations) },
      accepted,
    }),
  )

  if (
    endpoint.name === 'session' ||
    endpoint.name === 'entry-context' ||
    endpoint.name === 'my-memberships'
  ) {
    const idleDurations = []
    const idleWorkosDurations = []
    let idleErrors = 0
    for (let index = 0; index < idleCycles; index += 1) {
      await delay(idleMs)
      const result = await sample(endpoint.path)
      if (result.region) observedRegions.add(result.region)
      if (result.status < 200 || result.status >= 400) idleErrors += 1
      const target = result.usedWorkos ? idleWorkosDurations : idleDurations
      target.push(result.durationMs)
    }
    const idleSummary = summarize(idleDurations)
    const idleAccepted =
      idleErrors === 0 &&
      idleDurations.length > 0 &&
      idleSummary.p95 <= 500 &&
      idleSummary.p99 <= 800 &&
      idleSummary.max <= 1_000
    failed ||= !idleAccepted
    console.log(
      JSON.stringify({
        endpoint: endpoint.name,
        cohort: 'after-idle',
        samples: idleDurations.length,
        errors: idleErrors,
        ...idleSummary,
        workos: { samples: idleWorkosDurations.length, ...summarize(idleWorkosDurations) },
        accepted: idleAccepted,
      }),
    )
  }
}

if (!organizationId) {
  console.warn('STUDIO_TECHNICAL_ORGANIZATION_ID was not set; organization endpoints were skipped.')
}
if (expectedRegion) {
  const accepted =
    observedRegions.size > 0 && [...observedRegions].every((item) => item === expectedRegion)
  failed ||= !accepted
  console.log(
    JSON.stringify({
      check: 'vercel-region',
      expected: expectedRegion,
      observed: [...observedRegions],
      accepted,
    }),
  )
}
if (failed) process.exitCode = 1

async function sample(path) {
  const startedAt = globalThis.performance.now()
  const response = await globalThis.fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      Cookie: sessionCookie,
    },
    redirect: 'manual',
  })
  const durationMs = globalThis.performance.now() - startedAt
  await response.arrayBuffer()
  return {
    status: response.status,
    durationMs,
    usedWorkos: /(?:^|,)\s*workos-refresh;dur=/.test(response.headers.get('server-timing') ?? ''),
    region: vercelExecutionRegion(response.headers.get('x-vercel-id')),
  }
}

function summarize(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 }
  const sorted = values.toSorted((left, right) => left - right)
  return {
    p50: roundedPercentile(sorted, 0.5),
    p95: roundedPercentile(sorted, 0.95),
    p99: roundedPercentile(sorted, 0.99),
    max: round(sorted.at(-1) ?? 0),
  }
}

function roundedPercentile(sorted, percentile) {
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1)
  return round(sorted[index] ?? 0)
}

function round(value) {
  return Math.round(value * 10) / 10
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(value, fallback) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Sample counts must be positive')
  return parsed
}
import { setTimeout as delay } from 'node:timers/promises'
import { vercelExecutionRegion } from './vercel-region.mjs'
