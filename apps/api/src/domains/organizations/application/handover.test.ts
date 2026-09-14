import { describe, expect, test } from 'bun:test'
import { createInvitationToken, hashInvitationToken } from '@allfitone/notifications'

import type { OrganizationHandover, OrganizationHandoverDatabase } from '../domain/handover.js'
import { createOrganizationHandoverService } from './handover.js'

const KEY = Buffer.alloc(32, 7).toString('base64')
const ENVIRONMENT = { INVITATION_TOKEN_ACTIVE_VERSION: '2', INVITATION_TOKEN_KEY_V2: KEY }
const ACTOR = {
  actorPersonId: '019ab000-0000-7000-8000-000000000003',
  actorSessionId: '019ab000-0000-7000-8000-000000000023',
}
const COMMAND = {
  requestId: '8d2c0b7a-1111-4111-8111-111111111111',
  idempotencyKey: 'd1000000-0000-4000-8000-000000000001',
  commandId: '019ab000-0000-7000-8000-000000000501',
  requestHash: new Uint8Array(32),
}

function recordingDatabase(calls: unknown[]): OrganizationHandoverDatabase {
  const resource = {} as OrganizationHandover
  return {
    create: async (input) => {
      calls.push(input)
      return { resource, replayed: false }
    },
    read: async () => resource,
    resend: async (input) => {
      calls.push(input)
      return { resource, replayed: false }
    },
    cancel: async (input) => {
      calls.push(input)
      return { resource, replayed: false }
    },
  }
}

describe('organization handover service', () => {
  test('T-ORG-UNIT-01 hands the database the hash of the token the worker will send, never the token', async () => {
    const calls: unknown[] = []
    const service = createOrganizationHandoverService(recordingDatabase(calls), {
      environment: ENVIRONMENT,
    })

    await service.create(ACTOR, {
      ...COMMAND,
      handover: {
        display_name: 'Handover Norte',
        type_code: 'gym',
        party_kind: 'legal_entity',
        legal_name: 'Norte Fitness SAS',
        site: null,
        owner_email: 'owner@example.test',
      },
    })

    const expected = hashInvitationToken(createInvitationToken(COMMAND.commandId, KEY))
    expect(calls[0]).toMatchObject({ tokenKeyVersion: 2 })
    expect(Buffer.from((calls[0] as { tokenHash: Uint8Array }).tokenHash)).toEqual(
      Buffer.from(expected),
    )
    expect(JSON.stringify(calls[0])).not.toContain(createInvitationToken(COMMAND.commandId, KEY))
  })

  test('T-ORG-UNIT-02 refuses before writing anything when no token key is configured', async () => {
    const calls: unknown[] = []
    const service = createOrganizationHandoverService(recordingDatabase(calls), {
      environment: {},
    })

    expect(() =>
      service.resend(ACTOR, { ...COMMAND, organizationId: '019ab000-0000-7000-8000-000000000301' }),
    ).toThrow()
    expect(calls).toEqual([])
  })

  test('T-ORG-UNIT-03 cancels without deriving a token it does not need', async () => {
    const calls: unknown[] = []
    const service = createOrganizationHandoverService(recordingDatabase(calls), {
      environment: {},
    })

    await service.cancel(ACTOR, {
      ...COMMAND,
      organizationId: '019ab000-0000-7000-8000-000000000301',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toHaveProperty('tokenHash')
  })
})
