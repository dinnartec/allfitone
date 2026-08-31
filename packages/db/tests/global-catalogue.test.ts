/**
 * The curated catalogue, and the two properties that make it usable.
 *
 * These cannot be pgTAP tests: both need the curation script to be **run**, and
 * `db:reset` deliberately does not run it — production does not load `seed.sql`, and
 * this script is the thing that does go to production.
 *
 * The coverage assertion is the one that matters. A first cut of the catalogue hung
 * the frequency off each program rather than treating it as an axis, and somebody
 * starting who could train five days was offered content written for somebody
 * advanced. Forty-five cells, each with a program of its own band, is that defect
 * expressed as a test.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const CURATION_SCRIPT = join(import.meta.dir, '..', 'curation', '001_global_training_catalogue.sql')

const admin = postgres({
  host: process.env.SUPABASE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? 'postgres',
  username: process.env.SUPABASE_DB_USER ?? 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD ?? 'postgres',
  prepare: false,
  max: 1,
})

const GOALS = ['lose_weight', 'build_muscle', 'get_fit', 'run_a_race', 'maintain'] as const
const LEVELS = ['starting', 'some_practice', 'experienced'] as const
const FREQUENCIES = [3, 4, 5] as const

/** `psql` meta-commands are not SQL, so they cannot travel through the driver. */
function curationSql(): string {
  return readFileSync(CURATION_SCRIPT, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('\\'))
    .join('\n')
}

async function fingerprint(): Promise<string> {
  const [row] = await admin<{ digest: string }[]>`
    select md5(string_agg(entry, '|' order by entry)) as digest
    from (
      select id::text as entry from planning.programs
      union all select id::text from planning.program_versions
      union all select id::text from planning.program_version_sessions
      union all select id::text from planning.session_template_versions
      union all select id::text from planning.planned_steps
      union all select id::text from catalog.movements
      union all select program_version_id::text || goal_code from planning.program_version_goals
      union all select program_version_id::text || experience_code from planning.program_version_levels
    ) as fingerprint(entry)
  `
  return row?.digest ?? ''
}

beforeAll(async () => {
  await admin.unsafe(curationSql())
})

afterAll(async () => {
  await admin.end()
})

describe('the curated global catalogue', () => {
  test('loads twenty-four programs, each published with one version', async () => {
    const [row] = await admin<{ programs: number; versions: number }[]>`
      select (select count(*)::int from planning.programs
               where content_scope = 'global' and status = 'published') as programs,
             (select count(*)::int from planning.program_versions as version
                join planning.programs as program on program.id = version.program_id
               where program.content_scope = 'global') as versions
    `
    expect(row?.programs).toBe(24)
    expect(row?.versions).toBe(24)
  })

  test('carries no owner and no author, because the platform published it', async () => {
    const [row] = await admin<{ owned: number }[]>`
      select count(*)::int as owned from planning.programs
      where content_scope = 'global'
        and num_nonnulls(owner_organization_id, owner_person_id, author_person_id) > 0
    `
    expect(row?.owned).toBe(0)
  })

  test('prescribes effort and never a load', async () => {
    // A curated program cannot know what anybody lifts, and a kilo written here is a
    // kilo somebody trusts.
    const [row] = await admin<{ loaded: number }[]>`
      select count(*)::int as loaded from planning.strength_targets
      where target_load_value is not null
    `
    expect(row?.loaded).toBe(0)
  })

  test('offers three, four and five days for every goal and every level', async () => {
    const rows = await admin<
      { goal_code: string; experience_code: string; days_per_week: number }[]
    >`
      select goal.goal_code, level.experience_code, composition.days_per_week
      from planning.program_versions as version
      join planning.programs as program on program.id = version.program_id
      join planning.program_version_goals as goal on goal.program_version_id = version.id
      join planning.program_version_levels as level on level.program_version_id = version.id
      join lateral (
        select count(distinct session.day)::int as days_per_week
        from planning.program_version_sessions as session
        where session.program_version_id = version.id
      ) as composition on true
      where program.content_scope = 'global' and program.status = 'published'
    `

    const missing: string[] = []
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        for (const frequency of FREQUENCIES) {
          const found = rows.some(
            (row) =>
              row.goal_code === goal &&
              row.experience_code === level &&
              row.days_per_week === frequency,
          )
          if (!found) missing.push(`${goal}/${level}/${frequency}d`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  test('runs again without changing a single row', async () => {
    // This is what "loadable into production whenever you like" means, and it is the
    // only way to know it rather than believe it.
    const before = await fingerprint()
    await admin.unsafe(curationSql())
    const after = await fingerprint()

    expect(after).toBe(before)
    expect(before).not.toBe('')
  })
})
