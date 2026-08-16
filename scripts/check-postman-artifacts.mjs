import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const POSTMAN_ROOT = resolve(ROOT, 'postman')
const NATIVE_GIT_RESOURCES = resolve(ROOT, '.postman/resources.yaml')
const OPENAPI_PATH = resolve(ROOT, 'packages/contracts/openapi/allfit-v1.openapi.yaml')
const JOURNEYS_ROOT = resolve(POSTMAN_ROOT, 'collections/AllFit One - Local Journeys')
const SMOKE_ROOT = resolve(POSTMAN_ROOT, 'collections/AllFit One - Production Smoke')
const METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'])

const EXPECTED_ENVIRONMENTS = {
  Local: {
    backofficeOrigin: 'http://localhost:3001',
    baseUrl: 'http://localhost:8080',
    studioOrigin: 'http://localhost:3000',
  },
  Production: {
    backofficeOrigin: 'https://backoffice.allfit.one',
    baseUrl: 'https://api.allfit.one',
    studioOrigin: 'https://studio.allfit.one',
  },
}

const EXPECTED_SMOKE = new Map([
  ['/health', 'GET'],
  ['/backoffice/v1/telemetry-config', 'GET'],
  ['/space/v1/telemetry-config', 'GET'],
  ['/studio/v1/telemetry-config', 'GET'],
])

const EXPECTED_CLOUD_RESOURCES = {
  collections: new Set([
    '../postman/collections/AllFit One - Local Journeys',
    '../postman/collections/AllFit One - Production Smoke',
  ]),
  environments: new Set([
    '../postman/environments/Local.postman_environment.json',
    '../postman/environments/Production.postman_environment.json',
  ]),
  specs: new Set(['../packages/contracts/openapi/allfit-v1.openapi.yaml']),
}

const REQUIRED_JOURNEY_OPERATIONS = new Set([
  'startStudioAuthentication',
  'startStudioOnboardingAttempt',
  'createStudioOrganization',
  'createStudioTeamInvitation',
  'publishProgramVersion',
  'assignProgramVersion',
  'listMyAgenda',
  'startPlannedSessionAttempt',
  'replaceExecutionResults',
  'finalizeExecution',
  'getAuthorizedClientExecution',
  'createNutritionMeal',
  'revokeConsentGrant',
  'startBackofficePasswordAuthentication',
  'verifyBackofficeTotp',
  'getBackofficeSession',
])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function filesRecursively(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesRecursively(path)))
    else files.push(path)
  }
  return files
}

async function yamlFiles(directory, suffix) {
  const files = await filesRecursively(directory)
  return files.filter((file) => file.endsWith(suffix))
}

function scriptsFromRequest(request) {
  return (request.scripts ?? []).map((script) => script.code ?? '')
}

function requestPath(url) {
  const withoutBase = url.replace(/^\{\{baseUrl\}\}/, '')
  return withoutBase.split('?')[0].replaceAll(/\{\{[^}]+\}\}/g, '{id}')
}

async function validateEnvironments() {
  const directory = resolve(POSTMAN_ROOT, 'environments')
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json'))
  invariant(files.length === 2, 'Exactly Local and Production environments are allowed')

  const seen = new Set()
  for (const file of files) {
    const environment = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
    const expected = EXPECTED_ENVIRONMENTS[environment.name]
    invariant(expected, `Unexpected Postman environment: ${environment.name}`)
    invariant(!seen.has(environment.name), `Duplicate environment: ${environment.name}`)
    seen.add(environment.name)
    const values = Object.fromEntries(
      environment.values.map(({ enabled, key, type, value }) => {
        invariant(enabled === true, `${environment.name}.${key} must be enabled`)
        invariant(type === 'default', `${environment.name}.${key} must be a shared URL`)
        return [key, value]
      }),
    )
    invariant(
      Object.keys(values).length === Object.keys(expected).length &&
        Object.entries(expected).every(([key, value]) => values[key] === value),
      `${environment.name} contains unexpected keys or values`,
    )
  }
}

async function validateNativeGit() {
  const resources = parse(await readFile(NATIVE_GIT_RESOURCES, 'utf8'))
  invariant(
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(resources.workspace?.id ?? ''),
    'Native Git workspace ID is missing or invalid',
  )
  invariant(
    resources.workspace.id === '0ea60379-cfe3-4d6b-8b48-0be8b689fb56',
    'Native Git must target the AllFit One workspace',
  )

  const cloudResources = resources.cloudResources ?? {}
  invariant(
    Object.keys(cloudResources).length === Object.keys(EXPECTED_CLOUD_RESOURCES).length,
    'Native Git contains an unexpected resource category',
  )
  for (const [category, expectedPaths] of Object.entries(EXPECTED_CLOUD_RESOURCES)) {
    const mappings = cloudResources[category] ?? {}
    invariant(
      Object.keys(mappings).length === expectedPaths.size &&
        Object.keys(mappings).every((path) => expectedPaths.has(path)),
      `Native Git ${category} mappings changed unexpectedly`,
    )
    for (const [path, id] of Object.entries(mappings)) {
      invariant(
        /^[0-9]+-[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id),
        `Native Git mapping has an invalid ID: ${path}`,
      )
    }
  }
}

async function validateSmoke() {
  const definition = parse(
    await readFile(resolve(SMOKE_ROOT, '.resources/definition.yaml'), 'utf8'),
  )
  invariant(
    definition.name === 'AllFit One — Production Smoke',
    'Production smoke collection name changed',
  )
  invariant(definition.auth?.[0]?.type === 'noauth', 'Production smoke must use no auth')

  const requestFiles = await yamlFiles(SMOKE_ROOT, '.request.yaml')
  invariant(requestFiles.length === 4, 'Production smoke must contain exactly four requests')
  const actual = new Map()
  for (const file of requestFiles) {
    const request = parse(await readFile(file, 'utf8'))
    const path = requestPath(request.url)
    actual.set(path, request.method)
    invariant(request.method === 'GET', `Production smoke mutation detected in ${path}`)
    invariant(!request.body, `Production smoke body detected in ${path}`)
    invariant(!request.auth, `Production smoke request auth detected in ${path}`)
    invariant(
      !Object.keys(request.headers ?? {}).some((key) =>
        ['authorization', 'cookie'].includes(key.toLowerCase()),
      ),
      `Production smoke credential header detected in ${path}`,
    )
    const scripts = scriptsFromRequest(request).join('\n')
    invariant(scripts.includes('Status is 200'), `${path} has no status assertion`)
    invariant(scripts.includes('never sets cookies'), `${path} has no cookie assertion`)
    if (path.includes('telemetry-config')) {
      invariant(scripts.includes('public for five minutes'), `${path} has no cache assertion`)
      invariant(scripts.includes('response shape is closed'), `${path} has no shape assertion`)
    }
  }
  invariant(actual.size === EXPECTED_SMOKE.size, 'Production smoke paths are not unique')
  for (const [path, method] of EXPECTED_SMOKE) {
    invariant(actual.get(path) === method, `Missing production smoke request ${method} ${path}`)
  }
}

async function validateJourneys(openapiOperationIds) {
  const definition = parse(
    await readFile(resolve(JOURNEYS_ROOT, '.resources/definition.yaml'), 'utf8'),
  )
  invariant(
    definition.name === 'AllFit One — Local Journeys',
    'Local journeys collection name changed',
  )
  invariant(definition.auth?.[0]?.type === 'noauth', 'Local journeys must default to no auth')

  const requestFiles = await yamlFiles(JOURNEYS_ROOT, '.request.yaml')
  invariant(requestFiles.length > 0, 'Local journeys collection is empty')
  const represented = new Set()
  let replayCount = 0
  let staleEtagCount = 0
  for (const file of requestFiles) {
    const request = parse(await readFile(file, 'utf8'))
    const description = request.description ?? ''
    const operationId = description.match(/OpenAPI operation: ([A-Za-z0-9_]+)\./)?.[1]
    invariant(operationId, `Missing operationId metadata in ${relative(ROOT, file)}`)
    invariant(openapiOperationIds.has(operationId), `Unknown operationId ${operationId}`)
    represented.add(operationId)
    const scripts = scriptsFromRequest(request).join('\n')
    invariant(scripts.includes('Problem Details'), `${operationId} has no governed error test`)
    for (const code of scriptsFromRequest(request)) {
      // Syntax-only validation. Postman globals are intentionally not executed here.
      new Function(code)
    }
    if (scripts.includes('Replay returned the same governed success status')) replayCount += 1
    if (scripts.includes('A stale ETag is rejected')) staleEtagCount += 1
    const authorization = Object.entries(request.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'authorization',
    )?.[1]
    if (authorization) {
      invariant(
        /^Bearer \{\{\$vault:(space|studio)AccessToken\}\}$/.test(authorization),
        `${operationId} bearer auth must reference Local Vault`,
      )
    }
  }
  for (const operationId of REQUIRED_JOURNEY_OPERATIONS) {
    invariant(
      represented.has(operationId),
      `Required local journey operation missing: ${operationId}`,
    )
  }
  invariant(replayCount >= 5, 'Local journeys need explicit idempotency replay coverage')
  invariant(staleEtagCount === 1, 'Local journeys need one stale ETag rejection check')
}

async function validateNoSensitiveMaterial() {
  invariant(
    !(await stat(resolve(POSTMAN_ROOT, 'specs')).catch(() => undefined)),
    'Do not copy the canonical OpenAPI into postman/specs',
  )
  const files = await filesRecursively(POSTMAN_ROOT)
  const findings = []
  const patterns = [
    ['Postman API key', /\bPMAK-[A-Za-z0-9_-]{10,}\b/g],
    ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['real email', /\b[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ]
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    for (const [label, pattern] of patterns) {
      pattern.lastIndex = 0
      if (pattern.test(content)) findings.push(`${label}: ${relative(ROOT, file)}`)
    }
    if (file.endsWith('.request.yaml')) {
      const request = parse(content)
      const cookieHeader = Object.keys(request.headers ?? {}).find(
        (key) => key.toLowerCase() === 'cookie',
      )
      if (cookieHeader) findings.push(`cookie header: ${relative(ROOT, file)}`)
    }
  }
  invariant(!findings.length, `Sensitive material detected:\n${findings.join('\n')}`)
}

const openapi = parse(await readFile(OPENAPI_PATH, 'utf8'))
const operations = []
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (METHODS.has(method) && operation?.operationId) {
      operations.push({ method: method.toUpperCase(), operationId: operation.operationId, path })
    }
  }
}
const tags = new Set(
  operations.flatMap(({ operationId }) => {
    for (const pathItem of Object.values(openapi.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (METHODS.has(method) && operation?.operationId === operationId)
          return operation.tags ?? []
      }
    }
    return []
  }),
)
const operationIds = new Set(operations.map(({ operationId }) => operationId))
for (const telemetryOperation of [
  'getBackofficeTelemetryConfig',
  'getSpaceTelemetryConfig',
  'getStudioTelemetryConfig',
]) {
  invariant(
    operationIds.has(telemetryOperation),
    `Missing Platform Telemetry operation ${telemetryOperation}`,
  )
}
const generatedTypes = await readFile(
  resolve(ROOT, 'packages/contracts/generated/allfit-v1.ts'),
  'utf8',
)
invariant(generatedTypes.includes('TelemetryClientConfig'), 'Generated telemetry types are stale')
invariant(
  generatedTypes.includes('AnalyticsIdentity'),
  'Generated analytics identity types are stale',
)

await validateEnvironments()
await validateNativeGit()
await validateSmoke()
await validateJourneys(operationIds)
await validateNoSensitiveMaterial()

console.log(
  `Postman artifacts valid: ${Object.keys(openapi.paths ?? {}).length} paths, ${operations.length} operations, ${tags.size} tags, 2 environments.`,
)
