import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'
import { format, resolveConfig } from 'prettier'

const HTTP_METHODS = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const

type ContractOperation = {
  method: string
  path: string
  operationId: string
  allfitOperation: string
}

type ContractExclusion = {
  method: string
  path: string
  classification: string
  owner: string
  lifecycle: string
  reason: string
  exitCriterion?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordProperty(record: Record<string, unknown>, key: string, context: string) {
  const value = record[key]
  if (!isRecord(value)) {
    throw new Error(`${context}.${key} must be an object`)
  }
  return value
}

function stringProperty(record: Record<string, unknown>, key: string, context: string) {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`)
  }
  return value
}

function operationsFrom(document: Record<string, unknown>): ContractOperation[] {
  const paths = recordProperty(document, 'paths', 'OpenAPI document')
  const operations: ContractOperation[] = []

  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (!isRecord(pathItemValue)) {
      continue
    }

    for (const method of HTTP_METHODS) {
      const operationValue = pathItemValue[method]
      if (!isRecord(operationValue)) {
        continue
      }

      const context = `${method.toUpperCase()} ${path}`
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: stringProperty(operationValue, 'operationId', context),
        allfitOperation: stringProperty(operationValue, 'x-allfit-operation', context),
      })
    }
  }

  return operations.sort((left, right) =>
    `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`),
  )
}

function exclusionsFrom(document: Record<string, unknown>): ContractExclusion[] {
  const gate = recordProperty(document, 'x-allfit-contract-gate', 'OpenAPI document')
  const exclusionsValue = gate.exclusions
  if (!Array.isArray(exclusionsValue)) {
    throw new Error('OpenAPI document.x-allfit-contract-gate.exclusions must be an array')
  }

  return exclusionsValue
    .map((value, index) => {
      const context = `x-allfit-contract-gate.exclusions[${index}]`
      if (!isRecord(value)) {
        throw new Error(`${context} must be an object`)
      }

      const exitCriterionValue = value.exit_criterion
      if (exitCriterionValue !== undefined && typeof exitCriterionValue !== 'string') {
        throw new Error(`${context}.exit_criterion must be a string when present`)
      }

      return {
        method: stringProperty(value, 'method', context).toUpperCase(),
        path: stringProperty(value, 'path', context),
        classification: stringProperty(value, 'classification', context),
        owner: stringProperty(value, 'owner', context),
        lifecycle: stringProperty(value, 'lifecycle', context),
        reason: stringProperty(value, 'reason', context),
        ...(exitCriterionValue === undefined ? {} : { exitCriterion: exitCriterionValue }),
      }
    })
    .sort((left, right) =>
      `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`),
    )
}

function assertDistinctRoutes(
  operations: readonly ContractOperation[],
  exclusions: readonly ContractExclusion[],
) {
  const stableRoutes = new Set<string>()
  for (const operation of operations) {
    const route = `${operation.method} ${operation.path}`
    if (stableRoutes.has(route)) {
      throw new Error(`OpenAPI contains the stable route more than once: ${route}`)
    }
    stableRoutes.add(route)
  }

  const excludedRoutes = new Set<string>()
  for (const exclusion of exclusions) {
    const route = `${exclusion.method} ${exclusion.path}`
    if (excludedRoutes.has(route)) {
      throw new Error(`OpenAPI excludes the route more than once: ${route}`)
    }
    if (stableRoutes.has(route)) {
      throw new Error(`A route cannot be both stable and excluded: ${route}`)
    }
    excludedRoutes.add(route)
  }
}

async function bundleAsJson(specificationPath: string, repositoryRoot: string) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'allfitone-openapi-'))
  const bundledPath = join(temporaryDirectory, 'allfit-v1.json')
  const redoclyCli = join(repositoryRoot, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js')

  try {
    const processResult = Bun.spawn(
      [
        process.execPath,
        redoclyCli,
        'bundle',
        specificationPath,
        '--ext',
        'json',
        '--output',
        bundledPath,
        '--config',
        join(repositoryRoot, 'redocly.yaml'),
      ],
      { stderr: 'pipe', stdout: 'pipe' },
    )
    const [exitCode, stderr] = await Promise.all([
      processResult.exited,
      new Response(processResult.stderr).text(),
    ])

    if (exitCode !== 0) {
      throw new Error(`Redocly could not bundle the OpenAPI document:\n${stderr}`)
    }

    const parsed: unknown = JSON.parse(await readFile(bundledPath, 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error('The bundled OpenAPI document must be an object')
    }
    return parsed
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

async function writeFormatted(path: string, source: string) {
  const configuration = (await resolveConfig(path)) ?? {}
  const formatted = await format(source, { ...configuration, filepath: path })
  await writeFile(path, formatted)
}

async function generate() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(scriptDirectory, '..')
  const repositoryRoot = resolve(packageRoot, '../..')
  const specificationPath = join(packageRoot, 'openapi', 'allfit-v1.openapi.yaml')
  const generatedDirectory = join(packageRoot, 'generated')
  const typesPath = join(generatedDirectory, 'allfit-v1.ts')
  const manifestPath = join(generatedDirectory, 'allfit-v1-manifest.ts')

  const [ast, bundledDocument] = await Promise.all([
    openapiTS(pathToFileURL(specificationPath)),
    bundleAsJson(specificationPath, repositoryRoot),
  ])
  const operations = operationsFrom(bundledDocument)
  const exclusions = exclusionsFrom(bundledDocument)
  assertDistinctRoutes(operations, exclusions)
  const manifest = { operations, exclusions }

  await mkdir(generatedDirectory, { recursive: true })
  await Promise.all([
    writeFormatted(typesPath, `${COMMENT_HEADER}${astToString(ast)}`),
    writeFormatted(
      manifestPath,
      `${COMMENT_HEADER}export const allfitV1ContractManifest = ${JSON.stringify(manifest, null, 2)} as const\n`,
    ),
  ])
}

await generate()
