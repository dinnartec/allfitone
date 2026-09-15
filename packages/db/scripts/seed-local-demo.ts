/**
 * Local-only demo data for Backoffice.
 *
 * Backoffice reads what Studio and Space write, so a local database that has never run
 * those products shows empty screens — true, but useless for looking at the work. This
 * fills that gap through the **real commands** wherever one exists: the gym is created by
 * `organizations.create_organization`, its invitations by `identity.issue_staff_invitation`,
 * the credential by `identity.declare_professional_credential`. Only the people are
 * inserted directly, because activating one goes through a provider ceremony that has no
 * meaning offline.
 *
 * Every row it writes is named `Demo` and every code starts with `demo_`, so nothing here
 * can be mistaken for something a person actually did. It refuses any database that is
 * not on this machine, and it is idempotent: run it twice and the second run reports what
 * already exists.
 *
 *   bun packages/db/scripts/seed-local-demo.ts
 */

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const ISSUER = process.env.WORKOS_ISSUER ?? 'https://local.issuer.test'

const databaseUrl = process.argv.includes('--database-url')
  ? (process.argv[process.argv.indexOf('--database-url') + 1] ?? DEFAULT_URL)
  : (process.env.LOCAL_DATABASE_URL ?? DEFAULT_URL)
const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname
if (!LOCAL_HOSTS.has(host)) throw new Error(`refusing to seed ${host}: this script is local only`)

const sql = postgres(databaseUrl, { prepare: false, max: 1 })
try {
  await seed()
} finally {
  await sql.end()
}

async function seed(): Promise<void> {
  const { owner, coach } = await demoPeople()
  const organizationId = await demoGym(owner)
  await demoInvitations(owner, organizationId)
  await demoCredential(coach)

  const [counts] = await sql<
    Array<{ organizations: number; invitations: number; verifications: number }>
  >`
    select
      (select count(*)::integer from organizations.organizations) as organizations,
      (select count(*)::integer from identity.invitations) as invitations,
      (select count(*)::integer from identity.credential_verification_requests) as verifications
  `
  console.log(`Demo gym ${organizationId}`)
  console.log(
    `Now local has ${counts?.organizations} organization(s), ${counts?.invitations} invitation(s)` +
      ` and ${counts?.verifications} credential verification(s) waiting.`,
  )
  console.log('People: Demo Dueña, Demo Entrenador, Demo SinVerificar (no verified email).')
}

/** The three people the support screens need: two who can sign in, one who cannot. */
async function demoPeople(): Promise<{ owner: string; coach: string }> {
  const existing = await sql<Array<{ id: string; family_name: string }>>`
    select id, family_name from identity.people where given_name = 'Demo'
  `
  const people = existing.length
    ? existing
    : await sql<Array<{ id: string; family_name: string }>>`
        insert into identity.people (
          given_name, family_name, status, contact_email, contact_email_verified_at,
          contact_phone, contact_phone_verified_at
        ) values
          ('Demo', 'Duena', 'active', 'demo.owner@example.test', clock_timestamp(), null, null),
          ('Demo', 'Entrenador', 'active', 'demo.coach@example.test', clock_timestamp(),
            '+573001112233', clock_timestamp()),
          ('Demo', 'SinVerificar', 'active', 'demo.unverified@example.test', null, null, null)
        returning id, family_name
      `

  const owner = people.find((person) => person.family_name === 'Duena')?.id
  const coach = people.find((person) => person.family_name === 'Entrenador')?.id
  if (!owner || !coach) throw new Error('the demo people were not created')

  // An access account is what "this person can sign in" means to the support card, and
  // what account recovery needs. The third person deliberately has none.
  await sql`
    insert into identity.access_accounts (provider, issuer, subject, person_id)
    values ('workos', ${ISSUER}, ${`demo_owner_${owner.slice(0, 8)}`}, ${owner}::uuid),
           ('workos', ${ISSUER}, ${`demo_coach_${coach.slice(0, 8)}`}, ${coach}::uuid)
    on conflict (provider, issuer, subject) do nothing
  `
  return { owner, coach }
}

async function demoGym(owner: string): Promise<string> {
  const [existing] = await sql<Array<{ id: string }>>`
    select id from organizations.organizations where display_name = 'Demo Gimnasio Norte'
  `
  if (existing) return existing.id

  return sql.begin(async (transaction) => {
    await actor(transaction, 'person', owner)
    const [row] = await transaction<Array<{ organization_id: string }>>`
      select organization_id from organizations.create_organization(
        ${owner}::uuid, 'Demo Gimnasio Norte', 'gym', 'natural_person', null,
        ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${digest()}
      )
    `
    if (!row) throw new Error('PostgreSQL did not create the demo gym')
    return row.organization_id
  })
}

/**
 * One live invitation and one that already lapsed: the resend screen needs both to be
 * worth looking at, and the lapsed one is how an operator sees a reissue. The lapsed one
 * is aged rather than expired in place, because the table refuses an expiry that precedes
 * its own creation — and it is right to.
 */
async function demoInvitations(owner: string, organizationId: string): Promise<void> {
  const [existing] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count from identity.invitations
    where organization_id = ${organizationId}::uuid
  `
  if ((existing?.count ?? 0) > 0) return

  await sql.begin(async (transaction) => {
    await actor(transaction, 'person', owner)
    for (const invitation of [
      { contact: 'demo.pending@example.test', role: 'coach', lapsed: false },
      { contact: 'demo.lapsed@example.test', role: 'staff', lapsed: true },
    ]) {
      const commandId = uuidV7()
      await transaction`
        select identity.issue_staff_invitation(
          ${owner}::uuid, ${organizationId}::uuid, 'email', ${invitation.contact},
          ${invitation.role}, ${digest()}, 1::smallint,
          ${randomUUID()}::uuid, ${commandId}::uuid, ${digest()}
        )
      `
      if (invitation.lapsed) {
        await transaction`
          update identity.invitations
          set created_at = clock_timestamp() - interval '10 days',
              expires_at = clock_timestamp() - interval '3 days'
          where id = ${commandId}::uuid
        `
      }
    }
  })
}

/** A credential waiting in the queue, declared the way Studio declares one. */
async function demoCredential(coach: string): Promise<void> {
  const [existing] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count
    from identity.professional_credentials as credential
    join identity.professional_profiles as profile
      on profile.id = credential.professional_profile_id
    where profile.person_id = ${coach}::uuid
  `
  if ((existing?.count ?? 0) > 0) return

  await sql.begin(async (transaction) => {
    await actor(transaction, 'person', coach)
    // A credential hangs off a professional profile, so the profile comes first — the
    // same order Studio walks.
    const [specialty] = await transaction<Array<{ code: string }>>`
      select code from catalog.professional_specialties where status = 'published' limit 1
    `
    await transaction`
      select identity.put_professional_profile(
        ${coach}::uuid, 'Entrenador de demostración',
        'Perfil local para revisar las pantallas de Backoffice.', 2019,
        ${specialty ? [specialty.code] : []}::text[],
        ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${digest()}
      )
    `
    await transaction`
      select identity.declare_professional_credential(
        ${coach}::uuid, 'professional_license', 'Demo Ministerio del Deporte',
        'Licencia de entrenamiento demo', 'DEMO-1234',
        (clock_timestamp() - interval '400 days')::date,
        (clock_timestamp() + interval '200 days')::date,
        'https://example.test/demo-credential',
        ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${digest()}
      )
    `
  })
}

async function actor(
  transaction: postgres.TransactionSql,
  kind: 'person' | 'worker',
  personId?: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', ${kind}, true),
           set_config('app.actor_person_id', ${personId ?? ''}, true)
  `
}

function digest(): Buffer {
  return Buffer.from(randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), 'hex')
}

/** The commands take a UUIDv7 command id, and the invitation keeps it as its own id. */
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
