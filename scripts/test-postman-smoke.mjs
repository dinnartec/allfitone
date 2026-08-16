import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'

const ROOT = resolve(import.meta.dirname, '..')
const fixture = spawn(
  process.execPath,
  [resolve(import.meta.dirname, 'postman-smoke-fixture.mjs')],
  {
    cwd: ROOT,
    env: { ...process.env, POSTMAN_FIXTURE_PORT: '4010' },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
)

const ready = new Promise((resolveReady, reject) => {
  const timeout = setTimeout(
    () => reject(new Error('Postman smoke fixture did not start within 10 seconds')),
    10_000,
  )
  fixture.once('error', reject)
  fixture.stdout.setEncoding('utf8')
  fixture.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    if (chunk.includes('Postman smoke fixture listening')) {
      clearTimeout(timeout)
      resolveReady()
    }
  })
})

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

try {
  await ready
  const cli = process.env.POSTMAN_CLI ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx')
  const cliPrefix = process.env.POSTMAN_CLI ? [] : ['-y', 'postman-cli']
  await run(cli, [
    ...cliPrefix,
    'collection',
    'run',
    'postman/collections/AllFit One - Production Smoke',
    '--environment',
    'postman/environments/Local.postman_environment.json',
    '--env-var',
    'baseUrl=http://127.0.0.1:4010',
    '--bail',
    '--timeout-request',
    '5000',
  ])
} finally {
  fixture.kill('SIGTERM')
}
