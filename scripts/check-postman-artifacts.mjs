import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const POSTMAN_ROOT = resolve(ROOT, 'postman')
const COLLECTIONS_ROOT = resolve(POSTMAN_ROOT, 'collections')
const COLLECTION_ROOT = resolve(COLLECTIONS_ROOT, 'AllFit One - Development')
const ENVIRONMENTS_ROOT = resolve(POSTMAN_ROOT, 'environments')
const ENVIRONMENT_PATH = resolve(ENVIRONMENTS_ROOT, 'Local Development.postman_environment.json')
const RESOURCES_PATH = resolve(ROOT, '.postman/resources.yaml')
const OPENAPI_PATH = resolve(ROOT, 'packages/contracts/openapi/allfit-v1.openapi.yaml')
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put'])

const WORKSPACE_ID = '0ea60379-cfe3-4d6b-8b48-0be8b689fb56'
const COLLECTION_UID = '57465418-371c52ec-0811-47c2-9702-7e8e9b21a775'
const COLLECTION_ID = '371c52ec-0811-47c2-9702-7e8e9b21a775'
const ENVIRONMENT_UID = '57465418-b38e0f0a-f5b0-4e10-91e0-cf995038ad9e'
const ENVIRONMENT_ID = 'b38e0f0a-f5b0-4e10-91e0-cf995038ad9e'
const SPEC_UID = '34e1f771-367d-40b9-8911-10e1e3b084b0'

const EXPECTED_SHARED_VALUES = {
  baseUrl: 'http://localhost:8081',
  studioOrigin: 'http://localhost:3000',
  backofficeOrigin: 'http://localhost:3001',
  attemptId: '',
  credentialId: '',
  organizationId: '',
  invitationId: '',
  etag: '',
  spaceEmail: 'postman.space@example.invalid',
  backofficeEmail: '',
  specialtyCode: '',
  credentialTypeCode: '',
  intentId: '',
}

const EXPECTED_SECRET_KEYS = new Set([
  'spacePassword',
  'spaceVerificationCode',
  'spaceAccessToken',
  'backofficePassword',
  'backofficeTotp',
  'invitationToken',
  'studioAuthCode',
  'studioAuthState',
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

function canonicalPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, '{$1}')
}

function requestRoute(request) {
  const path = request.url.replace(/^\{\{baseUrl\}\}/, '').split('?')[0]
  return request.method.toUpperCase() + ' ' + canonicalPath(path)
}

function scriptsFromRequest(request) {
  return (request.scripts ?? []).map((script) => script.code ?? '')
}

async function validateResourceMap() {
  const resources = parse(await readFile(RESOURCES_PATH, 'utf8'))
  invariant(resources.workspace?.id === WORKSPACE_ID, 'Postman workspace ID is incorrect')

  const expected = {
    collections: {
      '../postman/collections/AllFit One - Development': COLLECTION_UID,
    },
    environments: {
      '../postman/environments/Local Development.postman_environment.json': ENVIRONMENT_UID,
    },
    specs: {
      '../packages/contracts/openapi/allfit-v1.openapi.yaml': SPEC_UID,
    },
  }

  invariant(
    JSON.stringify(resources.cloudResources) === JSON.stringify(expected),
    'Native Git resource mappings do not match the development workspace',
  )
}

async function validateTopology() {
  const collectionDirectories = []
  for (const entry of await readdir(COLLECTIONS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const definition = resolve(COLLECTIONS_ROOT, entry.name, '.resources/definition.yaml')
    if (await readFile(definition, 'utf8').catch(() => undefined)) {
      collectionDirectories.push(entry.name)
    }
  }
  invariant(
    JSON.stringify(collectionDirectories) === JSON.stringify(['AllFit One - Development']),
    'Exactly one Postman development collection is allowed',
  )

  const folders = (await readdir(COLLECTION_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== '.resources')
    .map((entry) => entry.name)
    .sort()
  invariant(
    JSON.stringify(folders) ===
      JSON.stringify(['00 - Platform', '01 - Studio', '02 - Space', '03 - Backoffice']),
    'The development collection has an unexpected top-level folder',
  )

  const definition = parse(
    await readFile(resolve(COLLECTION_ROOT, '.resources/definition.yaml'), 'utf8'),
  )
  invariant(definition.id === COLLECTION_ID, 'Development collection ID is incorrect')
  invariant(
    definition.name === 'AllFit One — Development',
    'Development collection name is incorrect',
  )

  const environmentFiles = (await readdir(ENVIRONMENTS_ROOT)).filter((name) =>
    name.endsWith('.json'),
  )
  invariant(
    JSON.stringify(environmentFiles) ===
      JSON.stringify(['Local Development.postman_environment.json']),
    'Exactly one local development environment is allowed',
  )
}

async function validateEnvironment() {
  const environment = JSON.parse(await readFile(ENVIRONMENT_PATH, 'utf8'))
  invariant(environment.id === ENVIRONMENT_ID, 'Local Development environment ID is incorrect')
  invariant(environment.name === 'Local Development', 'Environment name is incorrect')

  const variables = new Map(environment.values.map((variable) => [variable.key, variable]))
  const expectedKeys = new Set([...Object.keys(EXPECTED_SHARED_VALUES), ...EXPECTED_SECRET_KEYS])
  invariant(variables.size === expectedKeys.size, 'Environment has unexpected variables')

  for (const [key, value] of Object.entries(EXPECTED_SHARED_VALUES)) {
    const variable = variables.get(key)
    invariant(variable, 'Missing environment variable: ' + key)
    invariant(variable.enabled === true, key + ' must be enabled')
    invariant(variable.type === 'default', key + ' must use the default type')
    invariant(variable.value === value, key + ' has an unsafe shared value')
  }

  for (const key of EXPECTED_SECRET_KEYS) {
    const variable = variables.get(key)
    invariant(variable, 'Missing secret environment variable: ' + key)
    invariant(variable.enabled === true, key + ' must be enabled')
    invariant(variable.type === 'secret', key + ' must use the secret type')
    invariant(variable.value === '', key + ' must not have a shared value')
  }

  return expectedKeys
}

async function implementedContractRoutes(openapiRoutes) {
  process.env.API_PUBLIC_URL ??= 'https://api.example.test'
  process.env.STUDIO_WEB_URL ??= 'https://studio.example.test'
  process.env.BACKOFFICE_WEB_URL ??= 'https://backoffice.example.test'

  const { createApp } = await import('../apps/api/src/application.ts')
  const implemented = new Set(['GET /health'])
  for (const route of createApp().routes) {
    const key = route.method.toUpperCase() + ' ' + canonicalPath(route.path)
    if (openapiRoutes.has(key)) implemented.add(key)
  }
  return implemented
}

async function validateRequests(environmentKeys) {
  const openapi = parse(await readFile(OPENAPI_PATH, 'utf8'))
  const openapiRoutes = new Set()
  for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
    for (const [method] of Object.entries(pathItem)) {
      if (HTTP_METHODS.has(method)) openapiRoutes.add(method.toUpperCase() + ' ' + path)
    }
  }

  const expectedRoutes = await implementedContractRoutes(openapiRoutes)
  invariant(expectedRoutes.size === 37, 'Expected 36 mounted contract routes plus GET /health')

  const requestFiles = (await filesRecursively(COLLECTION_ROOT)).filter((file) =>
    file.endsWith('.request.yaml'),
  )
  invariant(requestFiles.length === 37, 'Development collection must contain 37 requests')

  const actualRoutes = new Map()
  const referencedVariables = new Set()
  for (const file of requestFiles) {
    const request = parse(await readFile(file, 'utf8'))
    const route = requestRoute(request)
    invariant(!actualRoutes.has(route), 'Duplicate Postman request: ' + route)
    actualRoutes.set(route, file)

    invariant(request.description?.includes(route), route + ' must describe its method and path')
    const scripts = scriptsFromRequest(request)
    invariant(scripts.length > 0, route + ' must have an after-response script')
    const joinedScripts = scripts.join('\n')
    invariant(
      joinedScripts.includes('Status esperado') ||
        joinedScripts.includes('flujo de autenticación respondió'),
      route + ' must assert its expected response',
    )
    invariant(joinedScripts.includes('Problem Details'), route + ' must validate governed errors')
    for (const script of scripts) new Function(script)

    const serialized = JSON.stringify(request)
    for (const match of serialized.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (!match[1].startsWith('$')) referencedVariables.add(match[1])
    }

    const headers = Object.keys(request.headers ?? {}).map((key) => key.toLowerCase())
    invariant(!headers.includes('authorization'), route + ' must not commit an auth header')
    invariant(!headers.includes('cookie'), route + ' must not commit a cookie header')
  }

  const missing = [...expectedRoutes].filter((route) => !actualRoutes.has(route))
  const extra = [...actualRoutes.keys()].filter((route) => !expectedRoutes.has(route))
  invariant(missing.length === 0, 'Missing implemented requests: ' + missing.join(', '))
  invariant(extra.length === 0, 'Collection contains non-runnable requests: ' + extra.join(', '))

  const unresolved = [...referencedVariables].filter((key) => !environmentKeys.has(key))
  invariant(unresolved.length === 0, 'Undefined Postman variables: ' + unresolved.join(', '))
}

async function validateSensitiveMaterial() {
  const findings = []
  const files = await filesRecursively(POSTMAN_ROOT)
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
      if (pattern.test(content)) findings.push(label + ': ' + relative(ROOT, file))
    }
  }
  invariant(findings.length === 0, 'Sensitive material detected:\n' + findings.join('\n'))
}

await validateResourceMap()
await validateTopology()
const environmentKeys = await validateEnvironment()
await validateRequests(environmentKeys)
await validateSensitiveMaterial()

console.log('Postman artifacts valid: 37 runnable requests, 1 local environment, 0 secrets.')
