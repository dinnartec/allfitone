/**
 * Local-only: publish the seven V1 scope definitions.
 *
 * Studio's client-invitation screen offers whatever `privacy.scope_definitions` holds, so
 * on a database where nothing has been published it says there are no permissions yet and
 * nobody can be invited. This fills that gap on **this machine only**, through the real
 * command, so the whole chain — publish, offer, invite, accept — can be looked at.
 *
 * The rules are the ones derived in `.claude/HUS_BACKOFFICE/PERMISOS_V1.md` from the
 * scopes table of `DOMAIN_OWNERSHIP_MAP.md`. That file also carries the six questions
 * nobody has answered yet, and they matter: **a published definition is immutable**, so in
 * production these are reviewed first and published by hand from `/permissions`. This
 * script is for the local chain, never for deciding what the rules are.
 *
 * It refuses any database that is not on this machine, and it is idempotent: a scope that
 * already has a version is left alone rather than given a second one.
 *
 *   bun --env-file=.env.local packages/db/scripts/publish-local-scopes.ts
 */

import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

interface Rule {
  resource: string
  field: string
  data_classification_code: 'training' | 'body' | 'health' | 'nutrition'
  max_action: 'read' | 'contribute'
  is_excluded?: boolean
  historical_readable?: boolean
}

const TRAINING_PRESCRIPTION = [
  'planning.program_assignments',
  'planning.planned_sessions',
  'planning.planned_steps',
  'planning.planned_sets',
  'planning.strength_targets',
  'planning.endurance_targets',
  'planning.interval_targets',
  'planning.mobility_targets',
]

const TRAINING_EXECUTION = [
  'execution.executed_sessions',
  'execution.session_segments',
  'execution.session_exercises',
  'execution.strength_sets',
  'execution.endurance_laps',
  'execution.interval_results',
  'execution.round_results',
  'execution.mobility_results',
]

/** Saying it out loud is the point: an omission reads as an oversight, this reads as a rule. */
function denied(
  resource: string,
  classification: Rule['data_classification_code'],
  field = '*',
): Rule {
  return {
    resource,
    field,
    data_classification_code: classification,
    max_action: 'read',
    is_excluded: true,
  }
}

function training(resource: string, action: Rule['max_action']): Rule {
  return {
    resource,
    field: '*',
    data_classification_code: 'training',
    max_action: action,
    historical_readable: action === 'read',
  }
}

const SCOPES: Array<{ code: string; rules: Rule[] }> = [
  {
    code: 'relationship_training',
    rules: [
      // `contribute`, so no history: the check requires `read` for a historical rule, and
      // what a professional may write is not what a frozen relationship may be read for.
      ...TRAINING_PRESCRIPTION.map((resource) => training(resource, 'contribute')),
      training('execution.planned_session_executions', 'contribute'),
      ...TRAINING_EXECUTION.map((resource) => training(resource, 'contribute')),
      denied('identity.body_progress_records', 'body'),
      denied('identity.health_context_claims', 'health'),
      denied('nutrition.meals', 'nutrition'),
    ],
  },
  {
    code: 'prior_training_history',
    rules: [
      ...TRAINING_EXECUTION.map((resource) => training(resource, 'read')),
      denied('planning.program_versions', 'training'),
      denied('planning.program_drafts', 'training'),
      denied('identity.body_progress_records', 'body'),
      denied('identity.health_context_claims', 'health'),
    ],
  },
  {
    code: 'body_progress',
    rules: [
      ...[
        'metric_code',
        'value_numeric',
        'unit_code',
        'original_value',
        'original_unit_code',
        'measured_on',
      ].map((field): Rule => ({
        resource: 'identity.body_progress_records',
        field,
        data_classification_code: 'body',
        max_action: 'read',
        historical_readable: true,
      })),
      // The photo stays out until stripping its metadata on the server exists.
      denied('identity.body_progress_records', 'body', 'media_ref'),
      denied('identity.body_progress_records', 'body', 'has_media'),
      denied('identity.health_context_claims', 'health'),
    ],
  },
  {
    code: 'health_context',
    rules: [
      // No history in V1, on any field. The documentation says so literally.
      ...['context_type', 'description', 'body_area', 'valid_from', 'valid_to'].map(
        (field): Rule => ({
          resource: 'identity.health_context_claims',
          field,
          data_classification_code: 'health',
          max_action: 'read',
        }),
      ),
      denied('identity.body_progress_records', 'body'),
    ],
  },
  {
    code: 'nutrition_intake',
    rules: [
      ...['occurred_at', 'timezone', 'local_date', 'meal_type', 'note'].map((field): Rule => ({
        resource: 'nutrition.meals',
        field,
        data_classification_code: 'nutrition',
        max_action: 'read',
      })),
      {
        resource: 'nutrition.meal_items',
        field: '*',
        data_classification_code: 'nutrition',
        max_action: 'read',
      },
      {
        resource: 'nutrition.meal_nutrient_values',
        field: '*',
        data_classification_code: 'nutrition',
        max_action: 'read',
      },
      // The photo has a permission of its own, and never reveals a meal by itself.
      denied('nutrition.meals', 'nutrition', 'media_ref'),
      denied('nutrition.meals', 'nutrition', 'has_media'),
    ],
  },
  {
    code: 'nutrition_guidance',
    rules: [
      // The table does not exist yet. `resource` is free text, so the rule can be declared;
      // what it grants is access to nothing until there is something to read.
      {
        resource: 'nutrition.guidance_notes',
        field: '*',
        data_classification_code: 'nutrition',
        max_action: 'read',
      },
      denied('nutrition.meals', 'nutrition'),
      denied('nutrition.meal_items', 'nutrition'),
    ],
  },
  {
    code: 'nutrition_media',
    rules: [
      {
        resource: 'nutrition.meals',
        field: 'media_ref',
        data_classification_code: 'nutrition',
        max_action: 'read',
      },
      denied('nutrition.meal_items', 'nutrition'),
      denied('nutrition.meal_nutrient_values', 'nutrition'),
    ],
  },
]

const argv = process.argv.slice(2)
const databaseUrl = value('--database-url') ?? process.env.LOCAL_DATABASE_URL ?? DEFAULT_URL
const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname
if (!LOCAL_HOSTS.has(host)) {
  throw new Error(`refusing to publish on ${host}: this script is local only`)
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 })
try {
  await publish()
} finally {
  await sql.end()
}

async function publish(): Promise<void> {
  const [curator] = await sql<Array<{ person_id: string; account_id: string }>>`
    select account.person_id, account.id as account_id
    from identity.access_accounts as account
    join support.platform_duty_assignments as duty
      on duty.person_id = account.person_id
     and duty.duty_code = 'curate_global_catalog'
     and duty.status = 'active'
     and duty.valid_from <= clock_timestamp()
     and duty.valid_to > clock_timestamp()
    where account.person_id is not null
    order by account.created_at
    limit 1
  `
  if (!curator) {
    console.log('Nobody holds curate_global_catalog on this database.')
    console.log('Run bootstrap-local-operator.ts first.')
    process.exitCode = 1
    return
  }

  for (const { code, rules } of SCOPES) {
    const [existing] = await sql<Array<{ count: number }>>`
      select count(*)::integer as count from privacy.scope_definitions
      where scope_code = ${code}
    `
    if ((existing?.count ?? 0) > 0) {
      console.log(`${code.padEnd(24)} already published, left alone`)
      continue
    }
    await publishOne(curator, code, rules)
    const included = rules.filter((rule) => !rule.is_excluded).length
    console.log(
      `${code.padEnd(24)} published · ${included} included, ${rules.length - included} excluded`,
    )
  }

  const [offerable] = await sql<Array<{ count: number }>>`
    select count(*)::integer as count from privacy.list_offerable_scopes()
  `
  console.log(`\nStudio can now offer ${offerable?.count ?? 0} permission(s) on an invitation.`)
  console.log('These rules are the draft in .claude/HUS_BACKOFFICE/PERMISOS_V1.md, not a decision.')
}

async function publishOne(
  curator: { person_id: string; account_id: string },
  code: string,
  rules: Rule[],
): Promise<void> {
  await sql.begin(async (transaction) => {
    const sessionId = randomUUID()
    await transaction`
      insert into identity.access_sessions (
        id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
        access_token_expires_at, assurance_level, authentication_method,
        assurance_verified_at, last_activity_at, absolute_expires_at
      ) values (
        ${sessionId}::uuid, ${curator.account_id}::uuid, ${`local_curator_${sessionId}`},
        'backoffice', ${randomBytes(32)}, 'v1.local-curator',
        clock_timestamp() + interval '5 minutes', 2, 'password_totp',
        clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '5 minutes'
      )
    `
    await transaction`
      select set_config('app.actor_kind', 'support', true),
             set_config('app.actor_person_id', ${curator.person_id}, true)
    `
    // Cast through text: the driver serializes an interpolated value as a JSON string.
    await transaction`
      select result from privacy.publish_scope_definition(
        ${curator.person_id}::uuid, ${sessionId}::uuid, ${code},
        ${JSON.stringify(rules)}::text::jsonb,
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
