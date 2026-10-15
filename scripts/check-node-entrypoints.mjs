/**
 * Checks that what gets deployed can actually run on Node, which is the only
 * thing Vercel runs.
 *
 * Everything else in this repository runs on Bun: the dev servers, every test
 * suite, every script. Bun loads a workspace package straight from its
 * TypeScript source. Node cannot, and Vercel does not even ship those `.ts`
 * files to the function. So a package whose `exports` serve `./src/index.ts`
 * passes lint, typecheck, tests and build, and then fails to load in
 * production — taking down every route behind it, because the failure happens
 * at import rather than on a path.
 *
 * That is not hypothetical: it is how the API answered `500` on every path,
 * including `/`, while `check:db-policy`, CI and the whole test suite stayed
 * green.
 *
 * There are two checks here, and the first is the one that matters.
 *
 * **What each package serves Node** is read from `package.json`, so it holds
 * whether or not the import happens to be exercised. It covers subpath exports
 * (`@allfitone/contracts/nutrients`) and it covers a package imported today
 * only for its types — which is one edit away from being imported for a value.
 *
 * **Loading the built entry point** then catches what a manifest cannot see.
 * It is the weaker of the two: on a developer's machine the `.ts` files exist
 * on disk and Node 22 will strip their types, so this check alone passes for a
 * package that Vercel would never ship. Run it, but do not trust it on its own.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const apps = [
  { name: 'apps/api', entry: 'apps/api/dist/index.js' },
  { name: 'apps/worker', entry: 'apps/worker/dist/main.js' },
]

const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))

/** Every path `exports` offers Node, as `[subpath, target]`. */
function nodeTargets(exported) {
  if (typeof exported === 'string') return [['.', exported]]
  return Object.entries(exported ?? {}).map(([subpath, target]) => [
    subpath,
    typeof target === 'string' ? target : (target.import ?? target.default ?? target.node),
  ])
}

const problems = []

for (const app of apps) {
  const manifest = await readJson(`${app.name}/package.json`)
  const workspace = Object.keys(manifest.dependencies ?? {}).filter((name) =>
    name.startsWith('@allfitone/'),
  )

  for (const name of workspace) {
    const directory = `packages/${name.slice('@allfitone/'.length)}`
    const dependency = await readJson(`${directory}/package.json`)

    for (const [subpath, target] of nodeTargets(dependency.exports)) {
      if (typeof target === 'string' && target.includes('/dist/')) continue
      problems.push(
        `${app.name} depends on ${name}, whose "${subpath}" export serves Node ${
          target ? `\`${target}\`` : 'nothing'
        }`,
      )
    }
    if (!dependency.scripts?.build) {
      problems.push(`${name} has no build script, so turbo's \`^build\` skips it`)
    }
  }
}

if (problems.length > 0) {
  throw new Error(
    `These workspace packages cannot be loaded by Node, so the function that imports one crashes on every route:\n  ${[
      ...new Set(problems),
    ].join('\n  ')}\n\n` +
      'Copy packages/auth-provider: a `build` script, and an `exports` entry per subpath that ' +
      'serves `./src/*.ts` to bun and `./dist/*.js` to import.',
  )
}

console.log(`Workspace packages that serve Node compiled JavaScript: verified`)

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

for (const { name, entry } of apps) {
  try {
    await import(pathToFileURL(path.join(root, entry)).href)
    console.log(`${name} loads under Node`)
  } catch (error) {
    failures.push(`${name} (${entry}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  throw new Error(`These entry points do not load under Node:\n  ${failures.join('\n  ')}`)
}

console.log(`Node entry points verified: ${apps.length}`)
