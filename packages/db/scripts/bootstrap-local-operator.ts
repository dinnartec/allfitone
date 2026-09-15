/**
 * Local-only Backoffice bootstrap.
 *
 * Signing in to Backoffice needs three things the database cannot invent: a person, an
 * access account carrying the provider subject, and an `allfit_admin` role granted by
 * somebody. The grant is a two-person ceremony by design, so a single operator cannot
 * appoint themselves — which is exactly what blocks a fresh local database.
 *
 * This script performs that ceremony against a local database and nothing else. It grants
 * `allfit_admin` and `manage_platform_access`, the duty that opens `/team`; every other
 * duty is then granted from the product itself, which is also the honest way to test it.
 *
 * It refuses any database that is not on this machine. The ceremony is audited in
 * production and belongs to a real approval, never to a script.
 *
 *   bun packages/db/scripts/bootstrap-local-operator.ts --subject user_01ABC --given-name Jimmy --family-name Rozo
 *
 * `--subject` is the WorkOS user id of the Backoffice Application user you sign in with.
 */

import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

interface Options {
  subject: string
  givenName: string
  familyName: string
  issuer: string
  databaseUrl: string
}

const options = readOptions(process.argv.slice(2))
await bootstrap(options)

async function bootstrap(input: Options): Promise<void> {
  const sql = postgres(input.databaseUrl, { prepare: false, max: 1 })
  try {
    const [existing] = await sql<Array<{ person_id: string | null }>>`
      select person_id from identity.access_accounts
      where provider = 'workos' and issuer = ${input.issuer} and subject = ${input.subject}
    `
    if (existing?.person_id) {
      console.log(`This subject already belongs to person ${existing.person_id}. Nothing to do.`)
      return
    }

    const operator = await sql.begin(async (transaction) => {
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

    console.log(`Person ${operator} is now an allfit_admin with manage_platform_access.`)
    console.log('Sign in at http://localhost:3001, enrol TOTP, then grant yourself the')
    console.log('remaining duties from "Equipo de Allfit".')
  } finally {
    await sql.end()
  }
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

  return {
    subject: subject.trim(),
    givenName: values.get('given-name') ?? 'Local',
    familyName: values.get('family-name') ?? 'Operator',
    issuer,
    databaseUrl,
  }
}
