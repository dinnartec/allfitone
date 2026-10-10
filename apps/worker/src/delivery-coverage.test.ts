/**
 * Every event the database enqueues for somebody to receive has a worker that knows
 * about it.
 *
 * This exists because `relationship.client_invited.v1` went unclaimed from the day
 * `OP-REL-001` shipped and nothing noticed. An unclaimed delivery event fails in the
 * worst way available: the command succeeds, the screen says the message went out, and
 * the row sits in the outbox reading "sin enviar todavía" forever in the technical
 * panel. No test could have caught it, because every test that mattered was about a
 * kind that did have a consumer.
 *
 * It looks for the event name anywhere in the worker's own source rather than inside a
 * `claim(...)` call, because the three processors claim three different ways — a
 * literal, an exported constant and a list — and a check that only understood the
 * first reported the account recovery topic as an orphan while the worker was plainly
 * delivering it. A false positive here would be worse than no check: it would be
 * disabled within a week.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const MIGRATIONS = join(import.meta.dir, '../../../packages/db/supabase/migrations')
const WORKER_SOURCE = import.meta.dir

/**
 * An event is a delivery when something has to leave the platform for a person to
 * receive it. Everything else the outbox carries is a domain record nobody is waiting
 * on, and the worker is right to ignore it.
 *
 * The list is curated on purpose. There is no syntactic tell — `invited`, `requested`,
 * `reassigned` — that separates a message to a person from a domain record, and a
 * pattern loose enough to catch them all would sweep in `organization.created.v1` and
 * report an orphan that is not one. **Add a kind here when the platform starts sending
 * a new one**, or this check will pass by ignoring it: that is how
 * `relationship.professional_reassigned.v1` went unexamined the first time.
 */
const DELIVERY_EVENT =
  /^(organization\.\w*invited|relationship\.(client_invited|professional_reassigned|substitution_proposed)|identity\.account_recovery_requested)\.v1$/

function enqueuedDeliveryEvents(): string[] {
  const found = new Set<string>()
  for (const file of readdirSync(MIGRATIONS)) {
    if (!file.endsWith('.sql')) continue
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    for (const [, event] of sql.matchAll(/'([a-z_]+\.[a-z_]+\.v1)'/g)) {
      if (event && DELIVERY_EVENT.test(event)) found.add(event)
    }
  }
  return [...found].sort()
}

function workerSource(): string {
  return readdirSync(WORKER_SOURCE)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(WORKER_SOURCE, file), 'utf8'))
    .join('\n')
}

describe('outbox delivery coverage', () => {
  test('finds the delivery events at all, so the comparison is not vacuous', () => {
    const events = enqueuedDeliveryEvents()

    expect(events).toContain('organization.staff_invited.v1')
    expect(events).toContain('organization.ownership_invited.v1')
    expect(events).toContain('identity.account_recovery_requested.v1')
    expect(events).toContain('relationship.client_invited.v1')
    expect(events).toContain('relationship.professional_reassigned.v1')
    expect(events).toContain('relationship.substitution_proposed.v1')
  })

  test('and would notice an event the worker never mentions', () => {
    // The check's own denial case: a name nothing enqueues is absent from the source.
    expect(workerSource()).not.toContain('relationship.invented_for_this_test.v1')
  })

  test('every delivery event the database enqueues is known to the worker', () => {
    const source = workerSource()
    const orphans = enqueuedDeliveryEvents().filter((event) => !source.includes(event))

    expect(orphans).toEqual([])
  })
})
