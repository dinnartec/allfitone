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
 * Training is the one exception to the "real commands" rule beyond the people: a session
 * that belongs to no plan has no command yet — `OP-EXE-004` is unimplemented — so those
 * rows are inserted. Everything the support screens read about them is real.
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

  const athlete = await demoAthlete()
  await demoBodyProgress(athlete)
  await demoHealthContext(athlete)
  await demoMeals(athlete)
  const trained = await demoTraining(athlete)

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
  console.log(
    `Demo Atleta has measurements, a health note, meals and training; ${trained} people` +
      ' trained inside the last seven days, which is what the business panel counts.',
  )
}

/**
 * The person the support screens are about. Everything Backoffice reads under a
 * break-glass window belongs to somebody, and none of it exists on a local database
 * until somebody trains, eats and measures themselves.
 */
async function demoAthlete(): Promise<{ person: string; account: string; subject: string }> {
  const [existing] = await sql<Array<{ id: string }>>`
    select id from identity.people where given_name = 'Demo' and family_name = 'Atleta'
  `
  const [created] = existing
    ? [existing]
    : await sql<Array<{ id: string }>>`
        insert into identity.people (
          given_name, family_name, status, contact_email, contact_email_verified_at
        ) values ('Demo', 'Atleta', 'active', 'demo.athlete@example.test', clock_timestamp())
        returning id
      `
  if (!created) throw new Error('PostgreSQL did not create the demo athlete')

  const subject = `demo_athlete_${created.id.slice(0, 8)}`
  const [account] = await sql<Array<{ id: string }>>`
    insert into identity.access_accounts (provider, issuer, subject, person_id)
    values ('workos', ${ISSUER}, ${subject}, ${created.id}::uuid)
    on conflict (provider, issuer, subject) do update set person_id = excluded.person_id
    returning id
  `
  if (!account) throw new Error('PostgreSQL did not create the demo athlete account')
  return { person: created.id, account: account.id, subject }
}

/**
 * Three measurements and one deletion. The deletion is what gives the erasure screen a
 * request to show: deleting your own measurement opens and closes a disposition case in
 * the same transaction, which is exactly what `HU-BO-032` follows.
 */
async function demoBodyProgress(athlete: {
  person: string
  account: string
  subject: string
}): Promise<void> {
  const [existing] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count from identity.body_progress_records
    where person_id = ${athlete.person}::uuid
  `
  if ((existing?.count ?? 0) > 0) return

  const measurements: Array<[string, number, string, number]> = [
    ['body_weight', 74, 'kg', 30],
    ['body_weight', 163, 'lb', 10],
    ['waist', 32, 'in', 3],
  ]
  const recorded: string[] = []
  for (const [metric, value, unit, daysAgo] of measurements) {
    const commandId = uuidV7()
    await sql.begin(async (transaction) => {
      await accountActor(transaction, athlete.account)
      await transaction`
        select identity.record_body_progress(
          ${athlete.account}::uuid, ${metric}, ${value}::numeric, ${unit},
          (current_date - make_interval(days => ${daysAgo}))::date,
          ${randomUUID()}::uuid, ${commandId}::uuid, ${digest()}
        )
      `
    })
    recorded.push(commandId)
  }

  // The one she took back. Her file keeps the case, never the figure.
  await sql.begin(async (transaction) => {
    await actor(transaction, 'person', athlete.person)
    await transaction`
      select identity.delete_body_progress(
        'workos', ${ISSUER}, ${athlete.subject}, ${recorded.at(-1)}::uuid,
        ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${digest()}
      )
    `
  })
}

/** One note that expires and one that does not, so the window shows both shapes. */
async function demoHealthContext(athlete: { person: string; subject: string }): Promise<void> {
  const [existing] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count from identity.health_context_claims
    where person_id = ${athlete.person}::uuid
  `
  if ((existing?.count ?? 0) > 0) return

  await sql.begin(async (transaction) => {
    await actor(transaction, 'person', athlete.person)
    await transaction`
      select identity.record_health_context(
        'workos', ${ISSUER}, ${athlete.subject}, ${uuidV7()}::uuid, 'pain',
        'Molestia en el hombro derecho al empujar por encima de la cabeza.', 'shoulder',
        clock_timestamp() - interval '20 days', clock_timestamp() + interval '40 days',
        ${randomUUID()}::uuid, ${digest()}
      )
    `
    await transaction`
      select identity.record_health_context(
        'workos', ${ISSUER}, ${athlete.subject}, ${uuidV7()}::uuid, 'limitation',
        'Evita impacto en rodillas por recomendacion medica.', 'knee',
        clock_timestamp() - interval '90 days', null,
        ${randomUUID()}::uuid, ${digest()}
      )
    `
  })
}

async function demoMeals(athlete: { person: string; subject: string }): Promise<void> {
  const [existing] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count from nutrition.meals
    where person_id = ${athlete.person}::uuid
  `
  if ((existing?.count ?? 0) > 0) return

  const meals: Array<[string, string, string, unknown]> = [
    [
      'breakfast',
      'Antes de entrenar.',
      '1 day',
      [
        { position: 1, name: 'Avena', quantity: 80, quantity_unit: 'g', nutrients: [] },
        { position: 2, name: 'Banano', nutrients: [] },
      ],
    ],
    [
      'lunch',
      'Almuerzo despues de la sesion.',
      '1 day',
      [
        { position: 1, name: 'Arroz', quantity: 150, quantity_unit: 'g', nutrients: [] },
        {
          position: 2,
          name: 'Pollo a la plancha',
          quantity: 200,
          quantity_unit: 'g',
          nutrients: [],
        },
      ],
    ],
  ]

  for (const [type, note, ago, items] of meals) {
    await sql.begin(async (transaction) => {
      await actor(transaction, 'person', athlete.person)
      await transaction`
        select nutrition.record_meal(
          ${athlete.person}::uuid,
          jsonb_build_object(
            'occurred_at', clock_timestamp() - ${ago}::interval, 'timezone', 'America/Bogota',
            'meal_type', ${type}::text, 'note', ${note}::text,
            'items', ${JSON.stringify(items)}::text::jsonb
          ),
          ${randomUUID()}::uuid, ${uuidV7()}::uuid, ${digest()}
        )
      `
    })
  }
}

/**
 * Training, and enough of it for the business panel to publish a figure: a count of
 * people is withheld below five, so five more people train besides the athlete.
 *
 * Inserted rather than commanded. A session that belongs to no plan has no command —
 * OP-EXE-004 is unimplemented — and execution.start_planned_session_attempt needs a
 * programme that a local database does not have.
 */
async function demoTraining(athlete: { person: string }): Promise<number> {
  const [shape] = await sql<Array<{ activity: string; contract: string }>>`
    select activity.id as activity, contract.id as contract
    from catalog.activity_types as activity, catalog.result_contracts as contract
    where contract.activity_family = 'strength'
    order by activity.code, contract.contract_code
    limit 1
  `
  if (!shape) {
    console.log('No activity type to train with, so no sessions were seeded.')
    return 0
  }

  const [existing] = await sql<Array<{ count: number }>>`
    select count(distinct person_id)::integer as count from execution.executed_sessions
    where started_at >= clock_timestamp() - interval '7 days'
  `
  if ((existing?.count ?? 0) >= 6) return existing?.count ?? 0

  const companions = await sql<Array<{ id: string }>>`
    insert into identity.people (given_name, family_name, status)
    select 'Demo', 'Activa' || step, 'active' from generate_series(1, 5) as step
    returning id
  `

  // Two for the athlete, one each for the others: the panel counts people, not sessions.
  const trainees = [athlete.person, athlete.person, ...companions.map((person) => person.id)]
  for (const [index, person] of trainees.entries()) {
    await sql`
      insert into execution.executed_sessions (
        id, person_id, activity_type_id, result_contract_id, contract_version,
        started_at, ended_at, timezone, requested_level, capture_source
      ) values (
        ${uuidV7()}::uuid, ${person}::uuid, ${shape.activity}::uuid, ${shape.contract}::uuid, 1,
        clock_timestamp() - make_interval(days => ${index % 6}, hours => 2),
        clock_timestamp() - make_interval(days => ${index % 6}, hours => 1),
        'America/Bogota', 'summary', 'manual'
      )
    `
  }
  return companions.length + 1
}

async function accountActor(
  transaction: postgres.TransactionSql,
  accountId: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'account', true),
           set_config('app.actor_account_id', ${accountId}, true)
  `
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
