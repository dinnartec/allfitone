/**
 * The patterns below are copied from the handler on purpose, not imported.
 *
 * `commandContext` in the identity handlers rejects anything these two do not
 * match, so a test that shared a constant with the code under test could drift
 * with it and stay green. This is the one place a literal duplicate is the point.
 */

import { describe, expect, test } from 'bun:test'

import { newCommand, uuidV4, uuidV7 } from './commands.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const bytes = (fill: number) => new Uint8Array(16).fill(fill)

describe('uuidV7', () => {
  test('is accepted by the pattern the API enforces', () => {
    expect(uuidV7(bytes(0), 0)).toMatch(UUID_V7)
    expect(uuidV7(bytes(0xff), 1_723_000_000_000)).toMatch(UUID_V7)
  })

  test('carries the timestamp in its leading bytes, so ids sort by time', () => {
    const earlier = uuidV7(bytes(0xaa), 1_723_000_000_000)
    const later = uuidV7(bytes(0xaa), 1_723_000_001_000)

    expect(earlier < later).toBe(true)
  })

  test('keeps the version and variant bits regardless of the random bytes', () => {
    for (const fill of [0x00, 0x0f, 0x7f, 0xff]) {
      const value = uuidV7(bytes(fill), 1_723_000_000_000)
      expect(value[14]).toBe('7')
      expect('89ab').toContain(value[19] as string)
    }
  })

  test('refuses fewer than sixteen bytes rather than emitting a short id', () => {
    expect(() => uuidV7(new Uint8Array(8), 0)).toThrow()
  })
})

describe('uuidV4', () => {
  test('is accepted by the pattern the API enforces', () => {
    expect(uuidV4(bytes(0))).toMatch(UUID_V4)
    expect(uuidV4(bytes(0xff))).toMatch(UUID_V4)
  })

  test('refuses fewer than sixteen bytes', () => {
    expect(() => uuidV4(new Uint8Array(15))).toThrow()
  })
})

describe('newCommand', () => {
  test('produces one key of each kind from the given randomness', () => {
    let calls = 0
    const random = {
      randomBytes: (length: number) => new Uint8Array(length).fill(calls++ === 0 ? 0x11 : 0x22),
    }

    const command = newCommand(random, 1_723_000_000_000)

    expect(command.idempotencyKey).toMatch(UUID_V4)
    expect(command.commandId).toMatch(UUID_V7)
  })

  test('does not reuse the same bytes for both keys', () => {
    let calls = 0
    const random = {
      randomBytes: (length: number) => new Uint8Array(length).fill(calls++),
    }

    const command = newCommand(random, 1_723_000_000_000)

    expect(calls).toBe(2)
    expect(command.idempotencyKey.replace(/-/g, '')).not.toBe(command.commandId.replace(/-/g, ''))
  })
})
