/**
 * Local-only: approve a pending break-glass window as the witness.
 *
 * A window is never approved by whoever asked for it. That is the point of it, it is
 * asserted in `T-SUP-BG-01`, and it is also what makes `HU-BO-008` and `HU-BO-009`
 * impossible to look at on a machine where only one person can sign in.
 *
 * The local witness exists so there is somebody else. `bootstrap-local-operator.ts` gives
 * it `approve_break_glass`; this decides with it, through `support.decide_break_glass` —
 * the same command the screen calls. Its session is opened with the assurance the command
 * demands and revoked before commit, so it can never be used for anything else.
 *
 * Nothing here weakens the rule: the requester still cannot approve, the quorum is still
 * the server's to compute, and the decision is recorded like any other.
 *
 *   bun packages/db/scripts/approve-local-break-glass.ts [--reason LOCAL-DEMO]
 */

import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const argv = process.argv.slice(2)
const reason = value('--reason') ?? 'LOCAL-DEMO'
const databaseUrl = value('--database-url') ?? process.env.LOCAL_DATABASE_URL ?? DEFAULT_URL
const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname
if (!LOCAL_HOSTS.has(host))
  throw new Error(`refusing to decide on ${host}: this script is local only`)

const sql = postgres(databaseUrl, { prepare: false, max: 1 })
try {
  await approve()
} finally {
  await sql.end()
}

async function approve(): Promise<void> {
  const pending = await sql<
    Array<{ id: string; case_reference: string; categories: string[]; requester: string }>
  >`
    select
      request.id,
      request.case_reference,
      request.categories,
      person.given_name || ' ' || person.family_name as requester
    from support.break_glass_requests as request
    join identity.people as person on person.id = request.requester_person_id
    where request.status = 'requested'
      and request.request_expires_at > clock_timestamp()
    order by request.requested_at
  `
  if (!pending.length) {
    console.log('No break-glass request is waiting for a decision.')
    console.log('Ask for one from the Backoffice screen first, then run this again.')
    return
  }

  for (const request of pending) {
    const decided = await decide(request.id)
    console.log(
      decided
        ? `Approved ${request.case_reference} (${request.categories.join(', ')}), asked for by ${request.requester}.`
        : `Could not approve ${request.case_reference}: no local witness holds approve_break_glass.`,
    )
  }
  console.log('The window is open for thirty minutes. Reload the screen and exercise it.')
}

/**
 * A restricted window — body measurements, health notes, meals — needs two approvals, and
 * no approver counts twice. Each witness decides in turn until the request stops being
 * pending; the server is what decides when that is, never this script.
 */
async function decide(requestId: string): Promise<boolean> {
  const witnesses = await sql<Array<{ person_id: string; account_id: string }>>`
    select account.person_id, account.id as account_id
    from identity.access_accounts as account
    join support.platform_duty_assignments as duty
      on duty.person_id = account.person_id
     and duty.duty_code = 'approve_break_glass'
     and duty.status = 'active'
     and duty.valid_from <= clock_timestamp()
     and duty.valid_to > clock_timestamp()
    join support.break_glass_requests as request
      on request.id = ${requestId}::uuid
     and request.requester_person_id <> account.person_id
    where account.subject like 'local_witness_%'
      and not exists (
        select 1 from support.break_glass_approvals as decided
        where decided.request_id = ${requestId}::uuid
          and decided.approver_person_id = account.person_id
      )
    order by account.created_at
  `
  if (!witnesses.length) return false

  for (const witness of witnesses) {
    const [still] = await sql<Array<{ status: string }>>`
      select status from support.break_glass_requests where id = ${requestId}::uuid
    `
    if (still?.status !== 'requested') break
    await decideAs(requestId, witness)
  }
  return true
}

async function decideAs(
  requestId: string,
  witness: { person_id: string; account_id: string },
): Promise<void> {
  await sql.begin(async (transaction) => {
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
    await transaction`
      select set_config('app.actor_kind', 'support', true),
             set_config('app.actor_person_id', ${witness.person_id}, true)
    `
    await transaction`
      select result from support.decide_break_glass(
        ${witness.person_id}::uuid, ${sessionId}::uuid, ${requestId}::uuid,
        'approved', ${reason},
        ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${randomBytes(32)}
      )
    `
    await transaction`
      update identity.access_sessions set revoked_at = clock_timestamp()
      where id = ${sessionId}::uuid
    `
  })
}

function value(flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

/** The commands take a UUIDv7 command id. */
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
