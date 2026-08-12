import { describe, expect, test } from 'bun:test'

import { createCommandIntentManager } from './command-intent.js'
import type { CommandHeaders } from './studio-api.js'

describe('command intentions', () => {
  test('reuses both command identifiers for an unchanged request after ambiguous failures', () => {
    const commands = commandSequence()
    const manager = createCommandIntentManager(() => commands.next())
    const request = {
      operation: 'credential:declare',
      resourceId: null,
      payload: {
        credential_type_code: 'professional_certification',
        issuer: 'NSCA',
        name: 'Certified Strength and Conditioning Specialist',
      },
    }
    const first = manager.commandFor(request)

    for (const _failure of ['TypeError', 'AbortError', '500', '502', '503', '422']) {
      expect(manager.commandFor(request)).toBe(first)
    }
  })

  test('rotates identifiers when the payload, operation or route resource changes', () => {
    const commands = commandSequence()
    const manager = createCommandIntentManager(() => commands.next())
    const first = manager.commandFor({
      operation: 'credential:revise',
      resourceId: 'credential-a',
      payload: { issuer: 'NSCA', name: 'Credential A' },
    })
    const changedPayload = manager.commandFor({
      operation: 'credential:revise',
      resourceId: 'credential-a',
      payload: { issuer: 'NSCA', name: 'Credential B' },
    })
    const changedResource = manager.commandFor({
      operation: 'credential:revise',
      resourceId: 'credential-b',
      payload: { issuer: 'NSCA', name: 'Credential B' },
    })
    const changedOperation = manager.commandFor({
      operation: 'credential:declare',
      resourceId: null,
      payload: { issuer: 'NSCA', name: 'Credential B' },
    })

    expect(changedPayload).not.toBe(first)
    expect(changedResource).not.toBe(changedPayload)
    expect(changedOperation).not.toBe(changedResource)
  })

  test('starts a new command after an intention is explicitly reset', () => {
    const commands = commandSequence()
    const manager = createCommandIntentManager(() => commands.next())
    const request = {
      operation: 'profile:update',
      resourceId: null,
      payload: { headline: 'Entrenador de fuerza' },
    }
    const first = manager.commandFor(request)

    manager.reset()

    expect(manager.commandFor(request)).not.toBe(first)
  })
})

function commandSequence(): { next: () => CommandHeaders } {
  let sequence = 0
  return {
    next: () => {
      sequence += 1
      return {
        idempotencyKey: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
        commandId: `01991600-0000-7000-8000-${sequence.toString().padStart(12, '0')}`,
      }
    },
  }
}
