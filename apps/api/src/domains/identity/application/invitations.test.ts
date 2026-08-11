import { describe, expect, test } from 'bun:test'

import type { IdentityInvitationDatabase } from '../domain/index.js'
import { createStudioInvitationService, StudioInvitationError } from './invitations.js'

const command = {
  organizationId: '0199b000-0000-7000-8000-000000000011',
  channel: 'email' as const,
  contact: 'person@example.test',
  proposedRoleCode: 'staff' as const,
  idempotencyKey: 'b2222222-2222-4222-8222-222222222222',
  commandId: '0199b000-0000-7000-8000-000000000031',
  requestHash: new Uint8Array(32),
}

test('derives the token hash before issuing the database command', async () => {
  let captured: Parameters<IdentityInvitationDatabase['issue']>[0] | undefined
  const database: IdentityInvitationDatabase = {
    issue: async (input) => {
      captured = input
      return {
        resource: {
          id: input.commandId,
          intentId: '0199b000-0000-7000-8000-000000000041',
          status: 'pending',
          channel: 'email',
          contactHint: 'p***@example.test',
          expiresAt: new Date('2026-08-18T12:00:00.000Z'),
          proposedRoleCode: 'staff',
          reused: false,
        },
        replayed: false,
      }
    },
  }
  const service = createStudioInvitationService(database, {
    enabled: true,
    environment: {
      INVITATION_TOKEN_ACTIVE_VERSION: '1',
      INVITATION_TOKEN_KEY_V1: Buffer.alloc(32, 9).toString('base64'),
    },
  })
  await service.issue(
    { accountId: 'account', personId: '0199b000-0000-7000-8000-000000000001' },
    command,
  )
  expect(captured?.tokenHash).toHaveLength(32)
  expect(captured?.tokenKeyVersion).toBe(1)
})

describe('invitation release gate', () => {
  test('fails closed before touching the database', () => {
    const service = createStudioInvitationService(
      { issue: async () => Promise.reject(new Error('must not run')) },
      { enabled: false },
    )
    expect(() =>
      service.issue(
        { accountId: 'account', personId: '0199b000-0000-7000-8000-000000000001' },
        command,
      ),
    ).toThrow(new StudioInvitationError('service-degraded'))
  })
})
