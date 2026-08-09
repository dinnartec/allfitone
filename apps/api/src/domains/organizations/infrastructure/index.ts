import { database } from '../../../platform/db/index.js'
import type postgres from 'postgres'
import type {
  OrganizationDatabase,
  OrganizationTypeCode,
  StudioMembership,
} from '../domain/index.js'

type MembershipRow = {
  membership_id: string
  organization_id: string
  display_name: string
  type_code: OrganizationTypeCode
  status: 'active' | 'terminated'
  joined_at: Date
  ended_at: Date | null
  roles: StudioMembership['roles']
}

export function createOrganizationDatabase(): OrganizationDatabase {
  const sql = database()

  return {
    async listTypes(personId) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        return transaction<{ code: OrganizationTypeCode; name: string }[]>`
          select * from organizations.list_organization_types()
        `
      })
    },

    async listMemberships(personId) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        const rows = await transaction<MembershipRow[]>`
          select * from organizations.list_my_memberships(${personId}::uuid)
        `
        return rows.map((row) => ({
          membershipId: row.membership_id,
          organizationId: row.organization_id,
          displayName: row.display_name,
          typeCode: row.type_code,
          status: row.status,
          joinedAt: new Date(row.joined_at),
          ...(row.ended_at ? { endedAt: new Date(row.ended_at) } : {}),
          roles: row.roles,
        }))
      })
    },

    async create(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId)
        const [row] = await transaction<
          {
            organization_id: string
            membership_id: string
            display_name: string
            type_code: OrganizationTypeCode
            role_code: 'owner'
          }[]
        >`
          select * from organizations.create_organization(
            ${input.personId}::uuid,
            ${input.displayName},
            ${input.typeCode},
            ${input.responsibleParty.kind},
            ${input.responsibleParty.name},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not create the organization')
        return {
          id: row.organization_id,
          membershipId: row.membership_id,
          displayName: row.display_name,
          typeCode: row.type_code,
          roles: [row.role_code],
        }
      })
    },
  }
}

async function setPersonActor(
  transaction: postgres.TransactionSql,
  personId: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true)
  `
}
