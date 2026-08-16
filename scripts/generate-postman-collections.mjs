import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const OPENAPI_PATH = resolve(ROOT, 'packages/contracts/openapi/allfit-v1.openapi.yaml')
const OUTPUT_DIRECTORY = resolve(process.argv[2] ?? resolve(ROOT, '.postman-generated'))
const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'])

const JOURNEYS = [
  {
    name: '01 - Public platform',
    operations: [
      'getBackofficeTelemetryConfig',
      'getSpaceTelemetryConfig',
      'getStudioTelemetryConfig',
    ],
  },
  {
    name: '02 - Studio onboarding and organizations',
    operations: [
      'startStudioAuthentication',
      'getStudioSession',
      'startStudioOnboardingAttempt',
      'recordStudioAdultEligibilityEvidence',
      'completeStudioOnboarding',
      'getStudioEntryContext',
      'listStudioOrganizationTypes',
      'createStudioOrganization',
      { operationId: 'createStudioOrganization', replay: true },
      'listMyStudioMemberships',
      'listStudioOrganizationMemberships',
      'listStudioOrganizationRoles',
    ],
  },
  {
    name: '03 - Team invitations',
    operations: [
      'createStudioTeamInvitation',
      { operationId: 'createStudioTeamInvitation', replay: true },
      'listStudioTeamInvitations',
      'resolveStudioTeamInvitation',
      'decideStudioTeamInvitation',
      'revokeStudioTeamInvitation',
    ],
  },
  {
    name: '04 - Studio planning to Space execution',
    operations: [
      'publishProgramVersion',
      { operationId: 'publishProgramVersion', replay: true },
      'assignProgramVersion',
      { operationId: 'assignProgramVersion', replay: true },
      'listMyAgenda',
      'startPlannedSessionAttempt',
      { operationId: 'startPlannedSessionAttempt', replay: true },
      { operationId: 'replaceExecutionResults', rememberStaleEtag: true },
      { operationId: 'replaceExecutionResults', staleEtag: true },
      'finalizeExecution',
      'getAuthorizedClientExecution',
    ],
  },
  {
    name: '05 - Nutrition, consent, and revocation',
    operations: [
      'createNutritionMeal',
      { operationId: 'createNutritionMeal', replay: true },
      'listMyNutritionMeals',
      'updateNutritionMeal',
      'listMyNutritionDailySummaries',
      'getMyNutritionGoals',
      'publishSelfNutritionGoalVersion',
      { operationId: 'publishSelfNutritionGoalVersion', replay: true },
      'decideNutritionGoalVersion',
      'listAuthorizedClientNutritionMeals',
      'listAuthorizedClientNutritionDailySummaries',
      'listAuthorizedClientNutritionGoalVersions',
      'proposeClientNutritionGoalVersion',
      { operationId: 'proposeClientNutritionGoalVersion', replay: true },
      'revokeConsentGrant',
      'deleteNutritionMeal',
    ],
  },
  {
    name: '06 - Backoffice AAL2',
    operations: [
      'startBackofficePasswordAuthentication',
      'getBackofficeAuthenticationAttempt',
      'verifyBackofficeTotp',
      'getBackofficeSession',
      'logoutBackofficeSession',
    ],
  },
]

const RESPONSE_VARIABLES = new Map([
  ['attempt_id', 'attemptId'],
  ['credential_id', 'credentialId'],
  ['etag', 'etag'],
  ['execution_id', 'executionId'],
  ['goal_version_id', 'goalVersionId'],
  ['grant_id', 'grantId'],
  ['invitation_id', 'invitationId'],
  ['meal_id', 'mealId'],
  ['organization_id', 'organizationId'],
  ['person_id', 'personId'],
  ['planned_session_id', 'plannedSessionId'],
  ['program_id', 'programId'],
  ['relationship_id', 'relationshipId'],
  ['version_id', 'programVersionId'],
])

const SYNTHETIC_STRINGS = new Map([
  ['email', 'postman.allfitone@example.invalid'],
  ['first_name', 'Alicia'],
  ['last_name', 'Prueba'],
  ['display_name', 'Alicia Prueba'],
  ['legal_name', 'AllFit One Synthetic Studio'],
  ['name', 'Synthetic value'],
  ['notes', 'Synthetic Postman journey data only'],
  ['reason', 'synthetic_postman_journey'],
  ['title', 'Synthetic AllFit One program'],
])

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(`allfitone-postman:${seed}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function resolveReference(document, value) {
  if (!value?.$ref) return value
  const parts = value.$ref.replace(/^#\//, '').split('/')
  return parts.reduce((current, part) => current?.[part], document)
}

function mergeAllOf(document, schema) {
  const resolved = resolveReference(document, schema) ?? {}
  if (!resolved.allOf) return resolved

  return resolved.allOf.reduce(
    (combined, member) => {
      const next = mergeAllOf(document, member)
      return {
        ...combined,
        ...next,
        properties: {
          ...(combined.properties ?? {}),
          ...(next.properties ?? {}),
        },
        required: [...new Set([...(combined.required ?? []), ...(next.required ?? [])])],
      }
    },
    { ...resolved, allOf: undefined },
  )
}

function variableForProperty(propertyName) {
  if (!propertyName) return undefined
  const direct = RESPONSE_VARIABLES.get(propertyName)
  if (direct) return direct
  if (propertyName.endsWith('_id')) return camelCase(propertyName)
  return undefined
}

function sampleFromSchema(document, inputSchema, propertyName) {
  const schema = mergeAllOf(document, inputSchema)
  if (schema.example !== undefined) return schema.example
  if (schema.const !== undefined) return schema.const
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.oneOf?.length) {
    return sampleFromSchema(document, schema.oneOf[0], propertyName)
  }
  if (schema.anyOf?.length) {
    return sampleFromSchema(document, schema.anyOf[0], propertyName)
  }

  const type = schema.type ?? (schema.properties ? 'object' : undefined)
  if (type === 'object') {
    const required = new Set(schema.required ?? [])
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([name, property]) => {
          const resolved = resolveReference(document, property) ?? {}
          return required.has(name) || resolved.example !== undefined
        })
        .map(([name, property]) => [name, sampleFromSchema(document, property, name)]),
    )
  }
  if (type === 'array') {
    return [sampleFromSchema(document, schema.items ?? {}, propertyName)]
  }
  if (type === 'boolean') return true
  if (type === 'integer' || type === 'number') {
    return schema.minimum ?? schema.exclusiveMinimum ?? 1
  }

  const variableName = variableForProperty(propertyName)
  if (variableName) return `{{${variableName}}}`
  if (SYNTHETIC_STRINGS.has(propertyName)) {
    return SYNTHETIC_STRINGS.get(propertyName)
  }
  if (schema.format === 'email') return 'postman.allfitone@example.invalid'
  if (schema.format === 'date') return '2026-08-16'
  if (schema.format === 'date-time') return '2026-08-16T12:00:00.000Z'
  if (schema.format === 'uri' || schema.format === 'url') {
    return 'https://example.invalid/allfitone/synthetic'
  }
  if (schema.format === 'uuid') {
    return `{{${camelCase(propertyName ?? 'resource_id')}}}`
  }
  if (propertyName === 'password') return '{{$vault:backofficePassword}}'
  if (propertyName === 'code') return '{{$vault:verificationCode}}'
  if (propertyName === 'totp_code') return '{{$vault:backofficeTotpCode}}'
  if (propertyName?.includes('token')) return '{{$vault:invitationToken}}'
  return `synthetic_${propertyName ?? 'value'}`
}

function operationInventory(document) {
  const result = new Map()
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation?.operationId) continue
      result.set(operation.operationId, { method, operation, path, pathItem })
    }
  }
  return result
}

function allParameters(document, entry) {
  return [...(entry.pathItem.parameters ?? []), ...(entry.operation.parameters ?? [])].map(
    (parameter) => resolveReference(document, parameter),
  )
}

function responseStatus(operation, staleEtag) {
  if (staleEtag) return 412
  const statuses = Object.keys(operation.responses ?? {})
    .filter((status) => /^[23]\d\d$/.test(status))
    .map(Number)
    .sort((a, b) => a - b)
  if (!statuses.length) {
    throw new Error(`Operation ${operation.operationId} has no success response`)
  }
  return statuses[0]
}

function responseMediaTypes(document, operation, status) {
  const response = resolveReference(document, operation.responses?.[String(status)])
  return Object.keys(response?.content ?? {})
}

function requestBody(document, operation) {
  const body = resolveReference(document, operation.requestBody)
  if (!body?.content) return undefined

  const mediaType = body.content['application/json']
    ? 'application/json'
    : body.content['application/x-www-form-urlencoded']
      ? 'application/x-www-form-urlencoded'
      : undefined
  if (!mediaType) return undefined

  const sample = sampleFromSchema(document, body.content[mediaType].schema, 'body')
  if (mediaType === 'application/json') {
    return {
      body: {
        mode: 'raw',
        raw: JSON.stringify(sample, null, 2),
        options: { raw: { language: 'json' } },
      },
      mediaType,
    }
  }

  return {
    body: {
      mode: 'urlencoded',
      urlencoded: Object.entries(sample).map(([key, value]) => ({
        key,
        type: 'text',
        value: String(value),
      })),
    },
    mediaType,
  }
}

function secretForBearer(path) {
  if (path.startsWith('/space/')) return 'spaceAccessToken'
  return 'studioAccessToken'
}

function operationHeaders(document, entry, options) {
  const headers = [
    {
      key: 'Accept',
      value: 'application/json, application/problem+json',
      type: 'text',
    },
  ]
  const parameters = allParameters(document, entry)
  const opKey = entry.operation.operationId

  for (const parameter of parameters.filter((item) => item?.in === 'header')) {
    const name = parameter.name
    let value = sampleFromSchema(document, parameter.schema ?? {}, name)
    if (name.toLowerCase() === 'idempotency-key') value = `{{idem_${opKey}}}`
    if (name.toLowerCase() === 'command-id') value = `{{command_${opKey}}}`
    if (name.toLowerCase() === 'if-match') {
      value = options.staleEtag ? '{{staleEtag}}' : '{{etag}}'
    }
    headers.push({ key: name, value: String(value), type: 'text' })
  }

  const body = requestBody(document, entry.operation)
  if (body) headers.push({ key: 'Content-Type', value: body.mediaType, type: 'text' })
  const security = entry.operation.security ?? document.security ?? []
  if (security.some((requirement) => requirement.bearerAuth)) {
    headers.push({
      key: 'Authorization',
      value: `Bearer {{$vault:${secretForBearer(entry.path)}}}`,
      type: 'text',
    })
  }
  if (entry.method !== 'get' && entry.method !== 'head' && entry.path.startsWith('/studio/')) {
    headers.push({ key: 'Origin', value: '{{studioOrigin}}', type: 'text' })
  }
  if (entry.method !== 'get' && entry.method !== 'head' && entry.path.startsWith('/backoffice/')) {
    headers.push({ key: 'Origin', value: '{{backofficeOrigin}}', type: 'text' })
  }
  return headers
}

function requestUrl(document, entry) {
  let rawPath = entry.path.replaceAll(/{([^}]+)}/g, '{{$1}}')
  const query = allParameters(document, entry)
    .filter((parameter) => parameter?.in === 'query' && parameter.required)
    .map((parameter) => {
      const value = sampleFromSchema(document, parameter.schema ?? {}, parameter.name)
      return `${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(value))}`
    })
  if (query.length) rawPath += `?${query.join('&')}`
  return `{{baseUrl}}${rawPath}`
}

function preRequestScript(document, entry, options) {
  const lines = []
  const opKey = entry.operation.operationId
  const headerNames = new Set(
    allParameters(document, entry)
      .filter((parameter) => parameter?.in === 'header')
      .map((parameter) => parameter.name.toLowerCase()),
  )
  if (headerNames.has('idempotency-key')) {
    lines.push(
      `if (!pm.variables.has("idem_${opKey}")) pm.variables.set("idem_${opKey}", pm.variables.replaceIn("{{$guid}}"));`,
    )
  }
  if (headerNames.has('command-id')) {
    lines.push(
      `if (!pm.variables.has("command_${opKey}")) pm.variables.set("command_${opKey}", pm.variables.replaceIn("{{$guid}}"));`,
    )
  }
  if (options.rememberStaleEtag) {
    lines.push(
      'if (pm.variables.get("etag")) pm.variables.set("staleEtag", pm.variables.get("etag"));',
    )
  }
  return lines
}

function testScript(document, entry, options, expectedStatus) {
  const mediaTypes = responseMediaTypes(document, entry.operation, expectedStatus)
  const expectsJson = mediaTypes.some((mediaType) =>
    ['application/json', 'application/problem+json'].includes(mediaType),
  )
  const lines = [
    `pm.test("Status is ${expectedStatus}", () => pm.response.to.have.status(${expectedStatus}));`,
    'const contentType = (pm.response.headers.get("Content-Type") || "").toLowerCase();',
    'if (pm.response.code >= 400) {',
    '  pm.test("Errors use application/problem+json", () => pm.expect(contentType).to.include("application/problem+json"));',
    '  pm.test("Problem Details has the governed shape", () => {',
    '    const problem = pm.response.json();',
    '    pm.expect(problem).to.have.property("type");',
    '    pm.expect(problem).to.have.property("title");',
    '    pm.expect(problem).to.have.property("status", pm.response.code);',
    '  });',
    '}',
  ]
  if (expectedStatus < 300 && expectedStatus !== 204 && expectsJson) {
    lines.push(
      'pm.test("Success response is JSON", () => pm.expect(contentType).to.include("application/json"));',
    )
  }
  lines.push(
    'const responseEtag = pm.response.headers.get("ETag");',
    'if (responseEtag) pm.variables.set("etag", responseEtag);',
    'if (contentType.includes("json") && pm.response.text()) {',
    '  const payload = pm.response.json();',
    `  const captures = ${JSON.stringify(Object.fromEntries(RESPONSE_VARIABLES))};`,
    '  const visit = (value) => {',
    '    if (!value || typeof value !== "object") return;',
    '    for (const [key, child] of Object.entries(value)) {',
    '      if (captures[key] && typeof child === "string") pm.variables.set(captures[key], child);',
    '      visit(child);',
    '    }',
    '  };',
    '  visit(payload);',
    '}',
  )
  if (options.replay) {
    lines.push(
      'pm.test("Replay returned the same governed success status", () => pm.expect(pm.response.code).to.equal(' +
        expectedStatus +
        '));',
    )
  }
  if (options.staleEtag) {
    lines.push(
      'pm.test("A stale ETag is rejected", () => pm.expect(pm.response.code).to.equal(412));',
    )
  }
  return lines
}

function event(listen, lines) {
  if (!lines.length) return undefined
  return {
    listen,
    script: {
      exec: lines,
      type: 'text/javascript',
      packages: {},
      requests: {},
    },
  }
}

function journeyItem(document, inventory, definition, index) {
  const options = typeof definition === 'string' ? { operationId: definition } : definition
  const entry = inventory.get(options.operationId)
  if (!entry) throw new Error(`Unknown operationId: ${options.operationId}`)
  const expectedStatus = responseStatus(entry.operation, options.staleEtag)
  const body = requestBody(document, entry.operation)
  const suffix = options.replay
    ? ' — replay same intent'
    : options.staleEtag
      ? ' — reject stale ETag'
      : ''
  const events = [
    event('prerequest', preRequestScript(document, entry, options)),
    event('test', testScript(document, entry, options, expectedStatus)),
  ].filter(Boolean)

  return {
    id: deterministicUuid(`journey:${options.operationId}:${index}`),
    name: `${entry.operation.summary}${suffix}`,
    request: {
      method: entry.method.toUpperCase(),
      header: operationHeaders(document, entry, options),
      ...(body ? { body: body.body } : {}),
      url: requestUrl(document, entry),
      description: [
        `OpenAPI operation: ${options.operationId}.`,
        'Run only against Local with synthetic data unless the canonical runbook explicitly says otherwise.',
      ].join('\n\n'),
    },
    response: [],
    event: events,
    protocolProfileBehavior:
      expectedStatus >= 300 && expectedStatus < 400 ? { followRedirects: false } : undefined,
  }
}

function makeJourneyCollection(document) {
  const inventory = operationInventory(document)
  const missing = JOURNEYS.flatMap((folder) => folder.operations)
    .map((definition) => (typeof definition === 'string' ? definition : definition.operationId))
    .filter((operationId) => !inventory.has(operationId))
  if (missing.length) throw new Error(`Missing journey operations: ${missing.join(', ')}`)

  return {
    info: {
      _postman_id: deterministicUuid('collection:local-journeys'),
      name: 'AllFit One — Local Journeys',
      description: [
        'Executable, Git-versioned workflows for the AllFit One backend.',
        "Use Local View and the Local environment. Studio and Backoffice browser sessions stay in Postman's cookie jar. Bearer tokens, passwords, TOTP codes, verification codes, and invitation tokens must live only in Postman Local Vault.",
        'Every request body is synthetic. Never save real responses, signed URLs, photos, cookies, tokens, personal data, medical data, or nutrition data as examples.',
        'The canonical contract is packages/contracts/openapi/allfit-v1.openapi.yaml; this collection is operational and must not be used as the API contract.',
      ].join('\n\n'),
      schema: COLLECTION_SCHEMA,
    },
    item: JOURNEYS.map((folder, folderIndex) => ({
      id: deterministicUuid(`folder:${folder.name}`),
      name: folder.name,
      description:
        'Run requests in order. IDs and ETags are held in run-local variables and are never shared to Postman Cloud.',
      item: folder.operations.map((definition, itemIndex) =>
        journeyItem(document, inventory, definition, `${folderIndex}:${itemIndex}`),
      ),
    })),
    auth: { type: 'noauth' },
    event: [],
    variable: [],
  }
}

function smokeTestScript(path) {
  const common = [
    'pm.test("Status is 200", () => pm.response.to.have.status(200));',
    'pm.test("Response is JSON", () => pm.expect((pm.response.headers.get("Content-Type") || "").toLowerCase()).to.include("application/json"));',
    'pm.test("Response never sets cookies", () => pm.expect(pm.response.headers.has("Set-Cookie")).to.equal(false));',
  ]
  if (path === '/health') {
    return [
      ...common,
      'pm.test("Health response shape is exact", () => pm.expect(pm.response.json()).to.deep.equal({ status: "ok" }));',
    ]
  }
  return [
    ...common,
    'pm.test("Telemetry cache policy is public for five minutes", () => pm.expect(pm.response.headers.get("Cache-Control")).to.equal("public, max-age=300"));',
    'pm.test("Telemetry response shape is closed", () => {',
    '  const payload = pm.response.json();',
    '  pm.expect(Object.keys(payload).sort()).to.eql(["enabled", "notice_version"]);',
    '  pm.expect(payload.enabled).to.be.a("boolean");',
    '  pm.expect(payload.notice_version).to.equal("analytics-v1");',
    '});',
  ]
}

function makeSmokeCollection() {
  const requests = [
    ['Health', '/health'],
    ['Backoffice telemetry config', '/backoffice/v1/telemetry-config'],
    ['Space telemetry config', '/space/v1/telemetry-config'],
    ['Studio telemetry config', '/studio/v1/telemetry-config'],
  ]
  return {
    info: {
      _postman_id: deterministicUuid('collection:production-smoke'),
      name: 'AllFit One — Production Smoke',
      description: [
        'Read-only production smoke suite. It performs exactly four unauthenticated GET requests and never creates, updates, deletes, or stores domain data.',
        'Run manually or through workflow_dispatch with the Production environment. Do not add authentication, cookies, examples, response bodies, or a schedule.',
      ].join('\n\n'),
      schema: COLLECTION_SCHEMA,
    },
    item: requests.map(([name, path], index) => ({
      id: deterministicUuid(`smoke:${path}:${index}`),
      name,
      request: {
        method: 'GET',
        header: [{ key: 'Accept', value: 'application/json', type: 'text' }],
        url: `{{baseUrl}}${path}`,
        description: 'Unauthenticated and non-mutating production-safe check.',
      },
      response: [],
      event: [event('test', smokeTestScript(path))],
    })),
    auth: { type: 'noauth' },
    event: [],
    variable: [],
  }
}

async function writeCollection(fileName, collection) {
  const target = resolve(OUTPUT_DIRECTORY, fileName)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(collection, null, 2)}\n`, 'utf8')
  return target
}

const document = parse(await readFile(OPENAPI_PATH, 'utf8'))
const outputs = await Promise.all([
  writeCollection(
    'allfit-one-local-journeys.postman_collection.json',
    makeJourneyCollection(document),
  ),
  writeCollection('allfit-one-production-smoke.postman_collection.json', makeSmokeCollection()),
])

console.log(`Generated ${outputs.length} Postman collections:`)
for (const output of outputs) console.log(`- ${output}`)
