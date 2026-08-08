import { readdir } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const appRoots = ['apps/studio-web/src', 'apps/backoffice-web/src']
const forbiddenStyleExtensions = new Set([
  '.css',
  '.less',
  '.pcss',
  '.sass',
  '.scss',
  '.styl',
  '.stylus',
  '.svg',
])

const violations = []

async function inspectDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join('/')

    if (entry.isDirectory()) {
      if (repositoryPath.includes('/src/components/ui')) {
        violations.push(`${repositoryPath}: local UI primitive directories are forbidden`)
        continue
      }

      await inspectDirectory(absolutePath)
      continue
    }

    if (entry.isFile() && forbiddenStyleExtensions.has(extname(entry.name).toLowerCase())) {
      violations.push(`${repositoryPath}: local UI assets and stylesheets are forbidden`)
    }
  }
}

await Promise.all(appRoots.map((appRoot) => inspectDirectory(resolve(repositoryRoot, appRoot))))

if (violations.length > 0) {
  console.error('UI boundary violations:')
  for (const violation of violations.toSorted()) {
    console.error(`- ${violation}`)
  }
  process.exitCode = 1
} else {
  console.log('Studio and Backoffice UI boundaries are valid.')
}
