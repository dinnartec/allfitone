import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DOMAINS = join(import.meta.dir, '..', '..', 'domains')

function adapterSources(): { path: string; source: string }[] {
  return readdirSync(DOMAINS).flatMap((domain) => {
    const directory = join(DOMAINS, domain, 'infrastructure')
    let files: string[]
    try {
      files = readdirSync(directory)
    } catch {
      return []
    }
    return files
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => ({
        path: `${domain}/infrastructure/${file}`,
        source: readFileSync(join(directory, file), 'utf8'),
      }))
  })
}

describe('JSON documents sent to PostgreSQL', () => {
  // packages/db/tests/json-parameters.test.ts shows why: the driver serializes the text again.
  test('T-PLAT-UNIT-01 no adapter casts an interpolated text straight to jsonb', () => {
    const offenders = adapterSources().flatMap(({ path, source }) =>
      source
        .split('\n')
        .filter((line) => /\}::jsonb\b/.test(line) && !/transaction\.json\(|sql\.json\(/.test(line))
        .map((line) => `${path}: ${line.trim()}`),
    )

    expect(offenders).toEqual([])
  })

  test('T-PLAT-UNIT-02 the check reads the adapters it guards', () => {
    const paths = adapterSources().map(({ path }) => path)

    expect(paths).toContain('nutrition/infrastructure/meals.ts')
    expect(paths).toContain('organizations/infrastructure/index.ts')
    expect(paths).toContain('catalog/infrastructure/index.ts')
    expect(paths).toContain('payments/infrastructure/index.ts')
  })
})
