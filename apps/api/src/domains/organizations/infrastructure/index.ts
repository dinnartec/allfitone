import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type {
  OrganizationDatabase,
  OrganizationRole,
  OrganizationRoleCode,
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

type OrganizationMembershipRow = {
  membership_id: string
  display_name: string
  status: 'active' | 'terminated'
  joined_at: Date
  ended_at: Date | null
  roles: OrganizationRoleCode[]
  sort_display_name: string
}

type OrganizationRoleRow = {
  role_code: OrganizationRoleCode
  role_name: string
  capability_code: string
  capability_name: string
}

const FITNESS_DATA_ACCESS_POLICIES: Record<
  OrganizationRoleCode,
  OrganizationRole['fitnessDataAccessPolicy']
> = {
  owner: 'not_granted_by_role',
  admin: 'not_granted_by_role',
  coach: 'requires_relationship_assignment_and_grant',
  staff: 'not_granted_by_role',
}

export function createOrganizationDatabase(): OrganizationDatabase {
  const sql = database()

  return {
    async listTypes(personId) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          return transaction<{ code: OrganizationTypeCode; name: string }[]>`
            select * from organizations.list_organization_types()
          `
        }),
      )
    },

    async listMemberships(personId) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
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
        }),
      )
    },

    async listOrganizationMemberships(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const rows = await transaction<OrganizationMembershipRow[]>`
            select * from organizations.list_organization_memberships(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${input.status ?? null}::text,
              ${input.limit + 1}::integer,
              ${input.cursorStatus ?? null}::text,
              ${input.cursorDisplayName ?? null}::text,
              ${input.cursorMembershipId ?? null}::uuid
            )
          `
          const hasMore = rows.length > input.limit
          return {
            hasMore,
            items: rows.slice(0, input.limit).map((row) => ({
              membershipId: row.membership_id,
              displayName: row.display_name,
              status: row.status,
              joinedAt: new Date(row.joined_at),
              endedAt: row.ended_at ? new Date(row.ended_at) : null,
              roles: row.roles,
              sortDisplayName: row.sort_display_name,
            })),
          }
        }),
      )
    },

    async listRoleCatalog(personId, organizationId) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          const rows = await transaction<OrganizationRoleRow[]>`
            select * from organizations.list_organization_roles(
              ${personId}::uuid,
              ${organizationId}::uuid
            )
          `
          return rows.reduce<OrganizationRole[]>((roles, row) => {
            let role = roles.at(-1)
            if (role?.code !== row.role_code) {
              role = {
                code: row.role_code,
                name: row.role_name,
                capabilities: [],
                fitnessDataAccessPolicy: FITNESS_DATA_ACCESS_POLICIES[row.role_code],
              }
              roles.push(role)
            }
            role.capabilities.push({ code: row.capability_code, name: row.capability_name })
            return roles
          }, [])
        }),
      )
    },

    async create(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
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
        }),
      )
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
