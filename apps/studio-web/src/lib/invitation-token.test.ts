import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  clearPendingInvitationToken,
  INVITATION_TOKEN_STORAGE_KEY,
  invitationTokenCaptureScript,
  readPendingInvitationToken,
  validInvitationToken,
} from './invitation-token'

const TOKEN = 'a'.repeat(43)
let values: Map<string, string>

beforeEach(() => {
  values = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage')
})

test('keeps only a valid tab-scoped invitation token', () => {
  values.set(INVITATION_TOKEN_STORAGE_KEY, TOKEN)
  expect(readPendingInvitationToken()).toBe(TOKEN)
  expect(validInvitationToken(`${TOKEN}x`)).toBeFalse()

  clearPendingInvitationToken()
  expect(readPendingInvitationToken()).toBeUndefined()
})

test('capture script removes the URL fragment and never places the token in a query', () => {
  const script = invitationTokenCaptureScript()
  expect(script).toContain('history.replaceState')
  expect(script).toContain('window.location.pathname+window.location.search')
  expect(script).not.toContain('searchParams.set')
})
