import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const migrationsDirectory = join(repositoryRoot, 'packages', 'db', 'supabase', 'migrations')
const seedPath = join(repositoryRoot, 'packages', 'db', 'supabase', 'seed.sql')
const workflowDirectory = join(repositoryRoot, '.github', 'workflows')
const failures = []

function fail(message) {
  failures.push(message)
}

function readSql(filePath) {
  return readFileSync(filePath, 'utf8')
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const timestamps = new Map()
for (const filename of migrationFiles) {
  const match = /^(\d{14})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.sql$/.exec(filename)
  if (!match) {
    fail(`Invalid migration filename: ${filename}`)
    continue
  }

  const [, timestamp] = match
  if (timestamps.has(timestamp)) {
    fail(`Duplicate migration timestamp ${timestamp}: ${timestamps.get(timestamp)} and ${filename}`)
  }
  timestamps.set(timestamp, filename)
}

const secretPatterns = [
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  {
    label: 'credential-bearing database URL',
    pattern: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/i,
  },
  { label: 'provider secret key', pattern: /\bsk_(?:live|test)_[a-z0-9_-]+/i },
  {
    label: 'JWT-like secret',
    pattern: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/,
  },
]

for (const filename of [...migrationFiles, basename(seedPath)]) {
  const filePath = filename === basename(seedPath) ? seedPath : join(migrationsDirectory, filename)
  const contents = readSql(filePath)
  for (const { label, pattern } of secretPatterns) {
    if (pattern.test(contents)) {
      fail(`${relative(repositoryRoot, filePath)} contains an apparent ${label}`)
    }
  }
}

const seedSql = stripSqlComments(readSql(seedPath))
if (
  /\b(?:create|alter|drop|truncate)\s+(?:schema|table|type|function|policy|role|extension|trigger|index)\b/i.test(
    seedSql,
  )
) {
  fail('packages/db/supabase/seed.sql contains schema DDL')
}

let base = argumentValue('--base') ?? process.env.DB_POLICY_BASE_SHA
if (base === '0000000000000000000000000000000000000000') base = undefined

const newMigrations = []
if (base) {
  try {
    runGit(['cat-file', '-e', `${base}^{commit}`])
    const changes = runGit([
      'diff',
      '--name-status',
      '--find-renames',
      base,
      '--',
      'packages/db/supabase/migrations',
    ])

    for (const line of changes.split(/\r?\n/).filter(Boolean)) {
      const [status, ...paths] = line.split('\t')
      const sqlPaths = paths.filter((filePath) => filePath.endsWith('.sql'))
      if (sqlPaths.length === 0) continue
      if (status === 'A') {
        const filePath = sqlPaths[0]
        if (filePath.endsWith('.sql')) newMigrations.push(resolve(repositoryRoot, filePath))
      } else if (/^[MDRC]/.test(status)) {
        fail(
          `Migration history is immutable; ${status} is not allowed for ${sqlPaths.join(' -> ')}`,
        )
      }
    }

    const untracked = runGit([
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      'packages/db/supabase/migrations/*.sql',
    ])
    for (const filePath of untracked.split(/\r?\n/).filter(Boolean)) {
      const absolutePath = resolve(repositoryRoot, filePath)
      if (!newMigrations.includes(absolutePath)) newMigrations.push(absolutePath)
    }
    // A migration dated before the newest one the base already has will deploy out
    // of order, and `supabase db push` refuses it: "found local migration files to
    // be inserted before the last migration on remote". Nothing is wrong with the
    // SQL — the timestamp is written when a branch starts and the order is decided
    // when it merges, so two branches in parallel cross over. It surfaced on
    // 2026-10-12 with seventeen migrations stuck behind work that shipped first,
    // and it surfaces at deploy time, where the only options left are a flag that
    // skips the check or renumbering after the fact. Here it is a rename away.
    const baseMigrations = runGit([
      'ls-tree',
      '-r',
      '--name-only',
      base,
      '--',
      'packages/db/supabase/migrations',
    ])
      .split(/\r?\n/)
      .filter((filePath) => filePath.endsWith('.sql'))
      .map((filePath) => basename(filePath).split('_')[0])
      .sort()
    const newestAtBase = baseMigrations.at(-1)
    if (newestAtBase) {
      for (const filePath of newMigrations) {
        const version = basename(filePath).split('_')[0]
        if (version < newestAtBase) {
          fail(
            `${basename(filePath)} is dated before ${newestAtBase}, which the base branch ` +
              'already has. Rename it to a later timestamp: deploying it would land out of order.',
          )
        }
      }
    }
  } catch (error) {
    fail(`Cannot compare migration history with base ${base}: ${error.message}`)
  }
} else {
  console.log('Database policy: no base commit supplied; immutable-history diff was skipped.')
}

const constraintPrefix = /^(?:pk|fk|uq|ck|ex)_/
for (const filePath of newMigrations) {
  if (!existsSync(filePath)) continue
  const filename = basename(filePath)
  const sql = stripSqlComments(readSql(filePath))

  if (!/\bset\s+lock_timeout\s*=/i.test(sql)) {
    fail(`${filename} does not set lock_timeout`)
  }
  if (!/\bset\s+statement_timeout\s*=/i.test(sql)) {
    fail(`${filename} does not set statement_timeout`)
  }

  for (const match of sql.matchAll(/\bcreate\s+(unique\s+)?index\s+([a-z][a-z0-9_]*)/gi)) {
    const expectedPrefix = match[1] ? 'uidx_' : 'idx_'
    if (!match[2].startsWith(expectedPrefix)) {
      fail(`${filename} index ${match[2]} must start with ${expectedPrefix}`)
    }
  }
  for (const match of sql.matchAll(
    /\balter\s+index\s+(?:[a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*\s+rename\s+to\s+([a-z][a-z0-9_]*)/gi,
  )) {
    if (!/^(?:idx|uidx)_/.test(match[1])) {
      fail(`${filename} renamed index ${match[1]} must start with idx_ or uidx_`)
    }
  }
  for (const match of sql.matchAll(/\bcreate\s+trigger\s+([a-z][a-z0-9_]*)/gi)) {
    if (!match[1].startsWith('trg_')) fail(`${filename} trigger ${match[1]} must start with trg_`)
  }
  for (const match of sql.matchAll(
    /\balter\s+trigger\s+[a-z][a-z0-9_]*[\s\S]*?\brename\s+to\s+([a-z][a-z0-9_]*)/gi,
  )) {
    if (!match[1].startsWith('trg_'))
      fail(`${filename} renamed trigger ${match[1]} must start with trg_`)
  }
  for (const match of sql.matchAll(
    /\bconstraint\s+([a-z][a-z0-9_]*)\s+(?:primary|foreign|unique|check|exclude)\b/gi,
  )) {
    if (!constraintPrefix.test(match[1])) {
      fail(`${filename} constraint ${match[1]} must use a canonical prefix`)
    }
  }
  for (const match of sql.matchAll(
    /\brename\s+constraint\s+[a-z][a-z0-9_]*\s+to\s+([a-z][a-z0-9_]*)/gi,
  )) {
    if (!constraintPrefix.test(match[1])) {
      fail(`${filename} renamed constraint ${match[1]} must use a canonical prefix`)
    }
  }
  for (const match of sql.matchAll(
    /\b(?:create\s+policy|alter\s+policy\s+[a-z][a-z0-9_]*[\s\S]*?rename\s+to)\s+([a-z][a-z0-9_]*)/gi,
  )) {
    if (!/^[a-z][a-z0-9_]*_(?:select|insert|update|delete|all)_[a-z0-9_]+$/.test(match[1])) {
      fail(`${filename} policy ${match[1]} must follow <table>_<action>_<rule>`)
    }
  }

  for (const match of sql.matchAll(
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:[a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*)/gi,
  )) {
    const table = match[1]
    const escapedTable = table.replace('.', '\\s*\\.\\s*')
    if (
      !new RegExp(
        `alter\\s+table\\s+${escapedTable}\\s+enable\\s+row\\s+level\\s+security`,
        'i',
      ).test(sql)
    ) {
      fail(`${filename} creates ${table} without enabling RLS in the same migration`)
    }
    if (
      !new RegExp(
        `alter\\s+table\\s+${escapedTable}\\s+force\\s+row\\s+level\\s+security`,
        'i',
      ).test(sql)
    ) {
      fail(`${filename} creates ${table} without forcing RLS in the same migration`)
    }
  }

  for (const line of sql.split(/\r?\n/)) {
    const looksLikeColumnDefinition = /^\s*[a-z][a-z0-9_]*\s+(?!constraint\b)/i.test(line)
    if (
      looksLikeColumnDefinition &&
      /\b(?:primary\s+key|references)\b/i.test(line) &&
      !/\bconstraint\s+(?:pk|fk|uq|ck|ex)_/i.test(line)
    ) {
      fail(`${filename} has an unnamed primary or foreign-key constraint: ${line.trim()}`)
    }
    if (
      looksLikeColumnDefinition &&
      /\bcheck\s*\(/i.test(line) &&
      !/\bwith\s+check\s*\(/i.test(line) &&
      !/\bconstraint\s+ck_/i.test(line)
    ) {
      fail(`${filename} has an unnamed check constraint: ${line.trim()}`)
    }
  }
}

if (existsSync(workflowDirectory)) {
  for (const filename of readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = readFileSync(join(workflowDirectory, filename), 'utf8')
    if (/supabase\s+db\s+reset[^\r\n]*--linked/i.test(workflow)) {
      fail(`${filename} attempts to reset a linked database`)
    }
    if (/supabase\s+db\s+push[^\r\n]*--include-seed/i.test(workflow)) {
      fail(`${filename} attempts to deploy seed data`)
    }
  }
}

if (failures.length > 0) {
  console.error('Database policy check failed:')
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}

console.log(
  `Database policy check passed (${migrationFiles.length} migrations, ${newMigrations.length} new).`,
)
