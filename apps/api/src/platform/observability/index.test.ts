import { describe, expect, spyOn, test } from 'bun:test'

import {
  recordStudioAuthCallback,
  recordStudioLogout,
  recordStudioMembershipDestination,
  recordStudioRegistrationIncomplete,
} from './index.js'

describe('Studio operational counters', () => {
  test('emits closed callback outcomes without provider or actor details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioAuthCallback('failed', 'state-mismatch')

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.callback',
      value: 1,
      dimensions: { outcome: 'failed', reason: 'state-mismatch' },
    })
    info.mockRestore()
  })

  test('emits registration and membership counters with non-identifying dimensions', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioRegistrationIncomplete()
    recordStudioMembershipDestination('multiple')

    expect(info.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      {
        kind: 'counter',
        name: 'studio.registration.incomplete',
        value: 1,
        dimensions: {},
      },
      {
        kind: 'counter',
        name: 'studio.membership.destination',
        value: 1,
        dimensions: { destination: 'multiple' },
      },
    ])
    info.mockRestore()
  })

  test('emits a closed logout trigger and outcome without session details', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)

    recordStudioLogout('inactivity', 'partial')

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.logout',
      value: 1,
      dimensions: { trigger: 'inactivity', outcome: 'partial' },
    })
    info.mockRestore()
  })
})
