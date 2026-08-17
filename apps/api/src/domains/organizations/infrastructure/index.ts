import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type {
  MembershipRoleGrant,
  Organization,
  OrganizationDatabase,
  OrganizationRole,
  OrganizationRoleCode,
  OrganizationSite,
  OrganizationTypeCode,
  OwnershipTransfer,
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

type OrganizationJson = {
  id: string
  display_name: string
  legal_name: string | null
  type_code: OrganizationTypeCode
  status: 'active' | 'closed'
  revision_number: number
  sites: OrganizationSiteJson[]
}

type OrganizationSiteJson = {
  id: string
  name: string
  address: string | null
  status: 'active' | 'inactive'
  revision_number: number
}

type OwnershipTransferJson = {
  organization_id: string
  owner_membership_id: string
  previous_owner_membership_id: string
  transferred_at: string
}

type MembershipRoleGrantJson = {
  membership_id: string
  role_code: Exclude<OrganizationRoleCode, 'owner'>
  valid_from: string
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

    async get(personId, organizationId, requestId) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId, requestId)
          const [row] = await transaction<{ result: OrganizationJson }[]>`
            select organizations.read_organization(${organizationId}::uuid) as result
          `
          if (!row) throw new Error('PostgreSQL did not return the organization')
          return organizationFromJson(row.result)
        }),
      )
    },

    async update(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const patch = {
            ...(input.patch.displayName !== undefined
              ? { display_name: input.patch.displayName }
              : {}),
            ...(input.patch.legalName !== undefined ? { legal_name: input.patch.legalName } : {}),
            ...(input.patch.typeCode !== undefined ? { type_code: input.patch.typeCode } : {}),
          }
          const [row] = await transaction<{ result: OrganizationJson; replayed: boolean }[]>`
            select * from organizations.update_organization(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${input.expectedRevision}::bigint,
              ${JSON.stringify(patch)}::jsonb,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          if (!row) throw new Error('PostgreSQL did not update the organization')
          return { resource: organizationFromJson(row.result), replayed: row.replayed }
        }),
      )
    },

    async createSite(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const [row] = await transaction<{ result: OrganizationSiteJson; replayed: boolean }[]>`
            select * from organizations.create_site(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${JSON.stringify(input.site)}::jsonb,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          if (!row) throw new Error('PostgreSQL did not create the organization site')
          return { resource: siteFromJson(row.result), replayed: row.replayed }
        }),
      )
    },

    async updateSite(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const [row] = await transaction<{ result: OrganizationSiteJson; replayed: boolean }[]>`
            select * from organizations.update_site(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${input.siteId}::uuid,
              ${input.expectedRevision}::bigint,
              ${JSON.stringify(input.patch)}::jsonb,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          if (!row) throw new Error('PostgreSQL did not update the organization site')
          return { resource: siteFromJson(row.result), replayed: row.replayed }
        }),
      )
    },

    async transferOwnership(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const [row] = await transaction<{ result: OwnershipTransferJson; replayed: boolean }[]>`
            select * from organizations.transfer_ownership(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${input.targetMembershipId}::uuid,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          if (!row) throw new Error('PostgreSQL did not transfer organization ownership')
          return { resource: ownershipTransferFromJson(row.result), replayed: row.replayed }
        }),
      )
    },

    async grantMembershipRole(input) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.personId)
          const [row] = await transaction<{ result: MembershipRoleGrantJson; replayed: boolean }[]>`
            select * from organizations.grant_membership_role(
              ${input.personId}::uuid,
              ${input.organizationId}::uuid,
              ${input.membershipId}::uuid,
              ${input.roleCode},
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          if (!row) throw new Error('PostgreSQL did not grant the membership role')
          return { resource: membershipRoleGrantFromJson(row.result), replayed: row.replayed }
        }),
      )
    },
  }
}

async function setPersonActor(
  transaction: postgres.TransactionSql,
  personId: string,
  requestId?: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true),
           set_config('app.request_id', ${requestId ?? ''}, true)
  `
}

function organizationFromJson(value: OrganizationJson): Organization {
  return {
    id: value.id,
    displayName: value.display_name,
    legalName: value.legal_name,
    typeCode: value.type_code,
    status: value.status,
    revisionNumber: value.revision_number,
    sites: value.sites.map(siteFromJson),
  }
}

function siteFromJson(value: OrganizationSiteJson): OrganizationSite {
  return {
    id: value.id,
    name: value.name,
    address: value.address,
    status: value.status,
    revisionNumber: value.revision_number,
  }
}

function ownershipTransferFromJson(value: OwnershipTransferJson): OwnershipTransfer {
  return {
    organizationId: value.organization_id,
    ownerMembershipId: value.owner_membership_id,
    previousOwnerMembershipId: value.previous_owner_membership_id,
    transferredAt: value.transferred_at,
  }
}

function membershipRoleGrantFromJson(value: MembershipRoleGrantJson): MembershipRoleGrant {
  return {
    membershipId: value.membership_id,
    roleCode: value.role_code,
    validFrom: value.valid_from,
  }
}
