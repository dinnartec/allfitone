import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const OPENAPI_PATH = resolve(ROOT, 'packages/contracts/openapi/allfit-v1.openapi.yaml')
const API_ROOT = 'https://api.postman.com'
const METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'])

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const apiKey = requiredEnvironment('POSTMAN_API_KEY')
const specId = requiredEnvironment('POSTMAN_SPEC_ID')
const collectionUid = requiredEnvironment('POSTMAN_CONTRACT_COLLECTION_UID')
const timeoutMs = Number(process.env.POSTMAN_SYNC_TIMEOUT_MS ?? 120_000)

function safeError(payload) {
  if (!payload || typeof payload !== 'object') return 'Postman returned no error details'
  const error = payload.error ?? payload
  return [error.name, error.message].filter(Boolean).join(': ') || 'Postman API error'
}

async function postman(path, options = {}) {
  const response = await globalThis.fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    throw new Error(
      `Postman ${options.method ?? 'GET'} ${path} failed (${response.status}): ${safeError(payload)}`,
    )
  }
  return payload
}

function operationsFromOpenApi(document) {
  const operations = []
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method] of Object.entries(pathItem)) {
      if (METHODS.has(method)) operations.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return operations
}

function requestPath(request) {
  const url = request.url
  let raw
  if (typeof url === 'string') raw = url
  else if (typeof url?.raw === 'string') raw = url.raw
  else if (Array.isArray(url?.path)) raw = `/${url.path.join('/')}`
  else throw new Error(`Generated request ${request.name ?? '<unnamed>'} has no URL`)

  raw = raw.replaceAll('{{baseUrl}}', '')
  if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname
  raw = raw.split(/[?#]/, 1)[0]
  if (!raw.startsWith('/')) raw = `/${raw}`
  return raw.replaceAll(/\{\{([^}]+)\}\}/g, '{$1}').replaceAll(/:([A-Za-z0-9_]+)(?=\/|$)/g, '{$1}')
}

function operationsFromCollection(collection) {
  const operations = []
  const visit = (items) => {
    for (const item of items ?? []) {
      if (item.request) {
        operations.push(`${item.request.method.toUpperCase()} ${requestPath(item.request)}`)
      }
      visit(item.item)
    }
  }
  visit(collection.item)
  return operations
}

function assertExactParity(expected, actual, label) {
  const actualCounts = new Map()
  for (const operation of actual) {
    actualCounts.set(operation, (actualCounts.get(operation) ?? 0) + 1)
  }
  const expectedSet = new Set(expected)
  const missing = expected.filter((operation) => !actualCounts.has(operation))
  const orphaned = [...actualCounts.keys()].filter((operation) => !expectedSet.has(operation))
  const duplicated = [...actualCounts.entries()]
    .filter(([, count]) => count !== 1)
    .map(([operation, count]) => `${operation} (${count} copies)`)
  if (missing.length || orphaned.length || duplicated.length) {
    throw new Error(
      `${label} parity failed:\n` +
        [
          missing.length ? `Missing:\n${missing.join('\n')}` : '',
          orphaned.length ? `Orphaned:\n${orphaned.join('\n')}` : '',
          duplicated.length ? `Duplicated:\n${duplicated.join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
    )
  }
}

async function waitForTask(taskPath) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await postman(taskPath)
    if (task.status === 'completed') return task
    if (['failed', 'error', 'cancelled'].includes(task.status)) {
      throw new Error(`Postman spec synchronization ended with status ${task.status}`)
    }
    await delay(1_000)
  }
  throw new Error(`Postman spec synchronization exceeded ${timeoutMs} ms`)
}

const openapiText = await readFile(OPENAPI_PATH, 'utf8')
const localOpenapi = parse(openapiText)
const expected = operationsFromOpenApi(localOpenapi)

await postman(`/specs/${encodeURIComponent(specId)}/files/allfit-v1.openapi.yaml`, {
  method: 'PATCH',
  body: JSON.stringify({ content: openapiText }),
})

const cloudDefinition = await postman(`/specs/${encodeURIComponent(specId)}/definitions`)
const cloudOpenapi = parse(
  typeof cloudDefinition === 'string' ? cloudDefinition : JSON.stringify(cloudDefinition),
)
assertExactParity(expected, operationsFromOpenApi(cloudOpenapi), 'Specification')

const synchronization = await postman(
  `/collections/${encodeURIComponent(collectionUid)}/synchronizations?specId=${encodeURIComponent(specId)}`,
  { method: 'PUT' },
)
if (!synchronization?.url) throw new Error('Postman did not return a synchronization task URL')
await waitForTask(synchronization.url)

const generations = await postman(
  `/specs/${encodeURIComponent(specId)}/generations/collection?limit=100`,
)
const collectionId = collectionUid.split('-').slice(1).join('-')
const generation = generations.collections?.find(
  ({ id }) => id === collectionId || collectionUid.endsWith(id),
)
if (!generation) throw new Error('Contract collection is not registered as generated from the spec')
if (generation.state !== 'in-sync') {
  throw new Error(`Contract collection state is ${generation.state}, expected in-sync`)
}

const response = await postman(`/collections/${encodeURIComponent(collectionUid)}`)
const actual = operationsFromCollection(response.collection)
assertExactParity(expected, actual, 'Contract collection')

console.log(
  `Postman contract synchronized: ${Object.keys(localOpenapi.paths ?? {}).length} paths, ${expected.length} operations, exact method/path parity.`,
)
