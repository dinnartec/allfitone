import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import prettier from 'prettier'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const outputPath = resolve(repositoryRoot, 'packages/db/types/database.types.ts')
const checkOnly = process.argv.includes('--check')

const generator = Bun.spawn(
  [
    process.execPath,
    'x',
    'supabase',
    'gen',
    'types',
    'typescript',
    '--local',
    '--schema',
    'identity,access_control,organizations',
    '--workdir',
    'packages/db',
  ],
  {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'inherit',
  },
)

const generated = await new Response(generator.stdout).text()
const exitCode = await generator.exited
if (exitCode !== 0) process.exit(exitCode)

const formatted = await prettier.format(generated, {
  ...(await prettier.resolveConfig(outputPath)),
  parser: 'typescript',
})

if (checkOnly) {
  const current = await Bun.file(outputPath)
    .text()
    .catch(() => '')
  // Git may check text files out with CRLF on Windows; generated content is
  // equivalent when its normalized LF representation matches.
  if (current.replaceAll('\r\n', '\n') !== formatted.replaceAll('\r\n', '\n')) {
    console.error('Generated PostgreSQL types are stale. Run `bun run db:types`.')
    process.exit(1)
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, formatted)
  console.log(`Generated ${outputPath}`)
}
