/**
 * Loads each deployed entry point with Node, which is the only thing Vercel runs.
 *
 * Everything else about this repository runs on Bun: the dev servers, every test
 * suite, every script. Bun resolves an import of `./factory.js` to `factory.ts`
 * and loads a workspace package straight from its TypeScript source. Node does
 * neither. A package that serves `./src/index.ts` therefore passes lint,
 * typecheck, tests and build, and then fails to load in production — taking the
 * whole function with it, because the failure happens at import rather than on a
 * route.
 *
 * That is not hypothetical: it is how the API answered `500` on every path,
 * including `/`, for days. This check is the one that would have caught it.
 *
 * Run it after `bun run build`. The placeholder environment exists only to get
 * past configuration validation — this asserts that the module graph loads, not
 * that the configuration is right.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const entrypoints = [
  { name: 'apps/api', file: 'apps/api/dist/index.js' },
  { name: 'apps/worker', file: 'apps/worker/dist/main.js' },
]

/** Values nothing connects to, chosen so configuration validation passes. */
const placeholders = {
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.invalid',
  STUDIO_WEB_URL: 'https://studio.invalid',
  BACKOFFICE_WEB_URL: 'https://backoffice.invalid',
  CATALOG_MEDIA_BASE_URL: 'https://media.invalid',
  WORKOS_ISSUER: 'https://issuer.invalid',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/postgres',
  SESSION_ENCRYPTION_KEY: '0'.repeat(64),
}

for (const [name, value] of Object.entries(placeholders)) process.env[name] ??= value

const failures = []

for (const { name, file } of entrypoints) {
  try {
    await import(pathToFileURL(path.join(root, file)).href)
    console.log(`${name} loads under Node`)
  } catch (error) {
    failures.push(`${name} (${file}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  throw new Error(
    `These entry points do not load under Node, so they cannot run on Vercel:\n  ${failures.join('\n  ')}\n\n` +
      'A workspace package the entry point imports for a value, rather than only for a type, ' +
      'must publish compiled JavaScript to Node. Copy packages/auth-provider: a build script, ' +
      'and an `exports` entry that serves `./src/index.ts` to bun and `./dist/index.js` to import.',
  )
}

console.log(`Node entry points verified: ${entrypoints.length}`)
