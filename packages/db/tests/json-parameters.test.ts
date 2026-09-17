/**
 * How a JSON document reaches a function through the driver the API uses.
 *
 * With `prepare: false`, postgres.js still learns each parameter's type from the server. A
 * string written as `${text}::jsonb` is therefore typed jsonb and serialized once more, so the
 * function receives a JSON string instead of the document inside it. Functions that check
 * `jsonb_typeof` then refuse a perfectly valid request. The API passes documents as
 * `${text}::text::jsonb` or `sql.json(value)`; these tests pin why.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'

const PERSON_ID = '019a9000-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '019a9000-0000-7000-8000-000000000101'

const sql = postgres({
  host: process.env.SUPABASE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? 'postgres',
  username: process.env.SUPABASE_DB_USER ?? 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD ?? 'postgres',
  prepare: false,
  max: 1,
})

afterAll(async () => {
  await sql.end({ timeout: 1 })
})

async function patchVerdict(cast: 'straight' | 'through-text'): Promise<string> {
  const patch = JSON.stringify({ display_name: 'Gimnasio Norte' })
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'person', true),
               set_config('app.actor_person_id', ${PERSON_ID}, true)
      `
      const document =
        cast === 'straight' ? transaction`${patch}::jsonb` : transaction`${patch}::text::jsonb`
      await transaction`
        select * from organizations.update_organization(
          ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, 0, ${document},
          gen_random_uuid(), '019a9000-0000-7000-8000-000000000301'::uuid,
          decode(repeat('ab', 32), 'hex')
        )
      `
    })
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('JSON documents through the API driver', () => {
  test('T-PLAT-INT-01 a JSON text cast straight to jsonb arrives as a string', async () => {
    const document = JSON.stringify({ display_name: 'Gimnasio Norte' })
    const [row] = await sql`
      select jsonb_typeof(${document}::jsonb) as straight,
             jsonb_typeof(${document}::text::jsonb) as through_text,
             jsonb_typeof(${sql.json({ display_name: 'Gimnasio Norte' })}) as helper
    `

    expect(row).toEqual({ straight: 'string', through_text: 'object', helper: 'object' })
  })

  test('T-PLAT-INT-02 a function that checks the document refuses the string and reads the document', async () => {
    // Refused as malformed before anything else is looked at.
    expect(await patchVerdict('straight')).toBe('invalid organization patch')
    // Read as the patch it is, and refused later for the organization that does not exist.
    expect(await patchVerdict('through-text')).not.toBe('invalid organization patch')
  })
})
