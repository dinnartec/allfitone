/**
 * Local-only Backoffice bootstrap.
 *
 * Signing in to Backoffice needs three things the database cannot invent: a person, an
 * access account carrying the provider subject, and an `allfit_admin` role granted by
 * somebody. The grant is a two-person ceremony by design, so a single operator cannot
 * appoint themselves — which is exactly what blocks a fresh local database.
 *
 * This script performs that ceremony against a local database and nothing else. The
 * ceremony grants `allfit_admin` and `manage_platform_access` to the operator and to a
 * second administrator, the local witness, who exists only so there is somebody else.
 *
 * Every other duty is granted afterwards **by the witness**, through the same command
 * the Team screen calls. It has to be: a duty is never self-assigned, and the witness is
 * the only other administrator a local database has. Nobody signs in as the witness, so
 * the script opens a short AAL2 session for it, grants, and revokes that session in the
 * same transaction.
 *
 * Duties expire by design. Run the script again when they do: an operator that already
 * exists is left alone, and only the duties that are no longer in force are granted.
 *
 * It refuses any database that is not on this machine. The ceremony is audited in
 * production and belongs to a real approval, never to a script.
 *
 *   bun --env-file=.env.local packages/db/scripts/bootstrap-local-operator.ts \
 *     --subject user_01ABC --given-name Jimmy --family-name Rozo \
 *     [--duties view_platform_metrics,diagnose_support_metadata]
 *
 * `--subject` is the WorkOS user id of the Backoffice Application user you sign in with.
 * Without `--duties`, every duty in the closed list is granted.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const DUTY_DAYS = 30

// The closed list of ADR-028. `manage_platform_access` comes from the ceremony itself.
const DUTIES = [
  'view_platform_metrics',
  'diagnose_support_metadata',
  'view_billing_metadata',
  'manage_organization_lifecycle',
  'request_break_glass',
  'verify_professional_credentials',
  'curate_global_catalog',
  'manage_platform_commercial',
  'audit_platform_access',
  'approve_break_glass',
  'audit_break_glass',
  'manage_privacy_requests',
] as const

interface Options {
  subject: string
  givenName: string
  familyName: string
  issuer: string
  databaseUrl: string
  duties: string[]
}

const options = readOptions(process.argv.slice(2))
await bootstrap(options)

async function bootstrap(input: Options): Promise<void> {
  const sql = postgres(input.databaseUrl, { prepare: false, max: 1 })
  try {
    const operator = await ensureOperator(sql, input)
    const granted = await grantDuties(sql, operator, input.duties)

    const effective = await sql<Array<{ duty_code: string; valid_to: Date }>>`
      select duty_code, valid_to
      from support.platform_duty_assignments
      where person_id = ${operator}::uuid
        and status = 'active'
        and valid_from <= clock_timestamp()
        and valid_to > clock_timestamp()
      order by duty_code
    `
    console.log(`Operator ${operator}`)
    console.log(granted.length ? `Granted now: ${granted.join(', ')}` : 'Nothing new to grant.')
    for (const duty of effective) {
      console.log(`  ${duty.duty_code} until ${duty.valid_to.toISOString().slice(0, 10)}`)
    }
    const missing = input.duties.filter(
      (duty) => !effective.some((held) => held.duty_code === duty),
    )
    if (missing.length) {
      console.log(`Still not in force: ${missing.join(', ')}`)
      process.exitCode = 1
    }
    console.log('Sign in at http://localhost:3001 and enrol TOTP if you have not yet.')
  } finally {
    await sql.end()
  }
}

async function ensureOperator(sql: postgres.Sql, input: Options): Promise<string> {
  const [existing] = await sql<Array<{ person_id: string | null }>>`
    select person_id from identity.access_accounts
    where provider = 'workos' and issuer = ${input.issuer} and subject = ${input.subject}
  `
  if (existing?.person_id) return existing.person_id

  return sql.begin(async (transaction) => {
    const [person] = await transaction<Array<{ id: string }>>`
      insert into identity.people (given_name, family_name, status)
      values (${input.givenName}, ${input.familyName}, 'active')
      returning id
    `
    // The ceremony needs two distinct administrators. The second one exists so the
    // first can be granted a role nobody grants themselves; nobody signs in as it.
    const [witness] = await transaction<Array<{ id: string }>>`
      insert into identity.people (given_name, family_name, status)
      values ('Local', 'Witness', 'active')
      returning id
    `
    if (!person || !witness) throw new Error('PostgreSQL did not create the local people')

    const witnessSubject = `local_witness_${person.id.slice(0, 8)}`
    await transaction`
      insert into identity.access_accounts (provider, issuer, subject)
      values ('workos', ${input.issuer}, ${input.subject}),
             ('workos', ${input.issuer}, ${witnessSubject})
      on conflict (provider, issuer, subject) do nothing
    `
    await transaction`
      select support.bootstrap_backoffice_administrators(
        ${person.id}::uuid, ${input.subject},
        ${witness.id}::uuid, ${witnessSubject},
        ${input.issuer}, clock_timestamp() + interval '30 days',
        ${`LOCAL-BOOTSTRAP-${new Date().toISOString().slice(0, 10)}`}
      )
    `
    return person.id
  })
}

/**
 * The witness grants, because nobody grants a duty to themselves. Its session lives
 * only for this transaction: opened with the assurance the command demands, revoked
 * before commit, so it can never be used for anything else.
 */
async function grantDuties(
  sql: postgres.Sql,
  operator: string,
  duties: string[],
): Promise<string[]> {
  return sql.begin(async (transaction) => {
    const pending = await transaction<Array<{ duty_code: string }>>`
      select wanted.duty_code
      from unnest(${duties}::text[]) as wanted(duty_code)
      where not exists (
        select 1 from support.platform_duty_assignments as held
        where held.person_id = ${operator}::uuid
          and held.duty_code = wanted.duty_code
          and held.status = 'active'
          and held.valid_from <= clock_timestamp()
          and held.valid_to > clock_timestamp()
      )
      order by wanted.duty_code
    `
    if (!pending.length) return []

    const [witness] = await transaction<Array<{ person_id: string; account_id: string }>>`
      select account.person_id, account.id as account_id
      from identity.access_accounts as account
      join support.platform_role_assignments as role
        on role.person_id = account.person_id
       and role.platform_role = 'allfit_admin'
       and role.status = 'active'
      where account.subject like 'local_witness_%'
        and account.person_id is not null
        and account.person_id <> ${operator}::uuid
      order by account.created_at desc
      limit 1
    `
    if (!witness) {
      throw new Error('no local witness holds allfit_admin; run `bun run db:reset` and start over')
    }

    const sessionId = randomUUID()
    await transaction`
      insert into identity.access_sessions (
        id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
        access_token_expires_at, assurance_level, authentication_method,
        assurance_verified_at, last_activity_at, absolute_expires_at
      ) values (
        ${sessionId}::uuid, ${witness.account_id}::uuid, ${`local_witness_${sessionId}`},
        'backoffice', ${randomBytes(32)}, 'v1.local-witness',
        clock_timestamp() + interval '5 minutes', 2, 'password_totp',
        clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '5 minutes'
      )
    `

    for (const { duty_code: duty } of pending) {
      await transaction`
        select result from support.assign_platform_duty(
          ${witness.person_id}::uuid, ${sessionId}::uuid, ${operator}::uuid, ${duty},
          clock_timestamp(), clock_timestamp() + ${`${DUTY_DAYS} days`}::interval,
          ${`LOCAL-BOOTSTRAP-${new Date().toISOString().slice(0, 10)}`},
          ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${randomBytes(32)}
        )
      `
    }

    await transaction`
      update identity.access_sessions set revoked_at = clock_timestamp()
      where id = ${sessionId}::uuid
    `
    return pending.map((row) => row.duty_code)
  })
}

function readOptions(argv: string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag?.startsWith('--') && value !== undefined) values.set(flag.slice(2), value)
  }

  const subject = values.get('subject')
  if (!subject || !subject.trim()) {
    throw new Error('--subject is required: the WorkOS user id you sign in with')
  }
  const issuer = values.get('issuer') ?? process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set and --issuer was not given')

  const databaseUrl = values.get('database-url') ?? process.env.LOCAL_DATABASE_URL ?? DEFAULT_URL
  const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`refusing to bootstrap ${host}: this ceremony is audited outside local`)
  }

  const requested = values.get('duties')
  const duties = requested
    ? requested
        .split(',')
        .map((duty) => duty.trim())
        .filter(Boolean)
    : [...DUTIES]
  const unknown = duties.filter((duty) => !(DUTIES as readonly string[]).includes(duty))
  if (unknown.length) {
    throw new Error(`unknown or ceremony-only duties: ${unknown.join(', ')}`)
  }

  return {
    subject: subject.trim(),
    givenName: values.get('given-name') ?? 'Local',
    familyName: values.get('family-name') ?? 'Operator',
    issuer,
    databaseUrl,
    duties,
  }
}

/** The command takes a UUIDv7 command id. */
function uuidV7(): string {
  const bytes = Buffer.from(randomUUID().replaceAll('-', ''), 'hex')
  let timestamp = Date.now()
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff
    timestamp = Math.floor(timestamp / 256)
  }
  bytes[6] = ((bytes.at(6) ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes.at(8) ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
