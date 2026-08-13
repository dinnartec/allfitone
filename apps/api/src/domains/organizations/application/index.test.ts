import { describe, expect, test } from 'bun:test'

import type { OrganizationDatabase } from '../domain/index.js'
import { createStudioOrganizationService, StudioOrganizationError } from './index.js'

describe('Studio organization registration boundary', () => {
  test('denies every organization operation before the account is linked to a person', async () => {
    let databaseCalls = 0
    const database: OrganizationDatabase = {
      listTypes: async () => {
        databaseCalls += 1
        return []
      },
      listMemberships: async () => {
        databaseCalls += 1
        return []
      },
      listOrganizationMemberships: async () => {
        databaseCalls += 1
        return { items: [], hasMore: false }
      },
      listRoleCatalog: async () => {
        databaseCalls += 1
        return []
      },
      create: async () => {
        databaseCalls += 1
        throw new Error('must not be reached')
      },
    }
    const service = createStudioOrganizationService(database)
    const accountOnlyActor = { accountId: 'account-without-person' }
    const command = {
      displayName: 'Unavailable',
      typeCode: 'studio' as const,
      responsibleParty: { kind: 'natural_person' as const, name: 'Unavailable' },
      idempotencyKey: 'idempotency-key',
      commandId: 'command-id',
      requestHash: new Uint8Array(),
    }

    expect(() => service.listTypes(accountOnlyActor)).toThrow(
      new StudioOrganizationError('registration-incomplete'),
    )
    expect(() => service.listMemberships(accountOnlyActor)).toThrow(
      new StudioOrganizationError('registration-incomplete'),
    )
    expect(() =>
      service.listOrganizationMemberships(accountOnlyActor, {
        organizationId: 'organization-id',
        limit: 50,
      }),
    ).toThrow(new StudioOrganizationError('registration-incomplete'))
    expect(() => service.listRoleCatalog(accountOnlyActor, 'organization-id')).toThrow(
      new StudioOrganizationError('registration-incomplete'),
    )
    expect(() => service.create(accountOnlyActor, command)).toThrow(
      new StudioOrganizationError('registration-incomplete'),
    )
    expect(databaseCalls).toBe(0)
  })
})
