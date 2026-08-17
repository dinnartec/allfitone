export type OrganizationTypeCode = 'professional_practice' | 'gym' | 'studio'
export type OrganizationRoleCode = 'owner' | 'admin' | 'coach' | 'staff'
export type OrganizationMembershipStatus = 'active' | 'terminated'
export type OrganizationStatus = 'active' | 'closed'
export type OrganizationSiteStatus = 'active' | 'inactive'
export type FitnessDataAccessPolicy =
  'not_granted_by_role' | 'requires_relationship_assignment_and_grant'

export interface OrganizationType {
  code: OrganizationTypeCode
  name: string
}

export interface StudioMembership {
  membershipId: string
  organizationId: string
  displayName: string
  typeCode: OrganizationTypeCode
  status: 'active' | 'terminated'
  joinedAt: Date
  endedAt?: Date
  roles: OrganizationRoleCode[]
}

export interface OrganizationMembershipListItem {
  membershipId: string
  displayName: string
  status: OrganizationMembershipStatus
  joinedAt: Date
  endedAt: Date | null
  roles: OrganizationRoleCode[]
  sortDisplayName: string
}

export interface OrganizationMembershipPage {
  items: OrganizationMembershipListItem[]
  hasMore: boolean
}

export interface OrganizationCapability {
  code: string
  name: string
}

export interface OrganizationRole {
  code: OrganizationRoleCode
  name: string
  capabilities: OrganizationCapability[]
  fitnessDataAccessPolicy: FitnessDataAccessPolicy
}

export interface CreatedOrganization {
  id: string
  membershipId: string
  displayName: string
  typeCode: OrganizationTypeCode
  roles: Array<'owner'>
}

export interface OrganizationSite {
  id: string
  name: string
  address: string | null
  status: OrganizationSiteStatus
  revisionNumber: number
}

export interface Organization {
  id: string
  displayName: string
  legalName: string | null
  typeCode: OrganizationTypeCode
  status: OrganizationStatus
  revisionNumber: number
  sites: OrganizationSite[]
}

export interface OwnershipTransfer {
  organizationId: string
  ownerMembershipId: string
  previousOwnerMembershipId: string
  transferredAt: string
}

export interface MembershipRoleGrant {
  membershipId: string
  roleCode: Exclude<OrganizationRoleCode, 'owner'>
  validFrom: string
}

export interface OrganizationCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface OrganizationCommandResult<T> {
  resource: T
  replayed: boolean
}

export interface OrganizationDatabase {
  listTypes(personId: string): Promise<OrganizationType[]>
  listMemberships(personId: string): Promise<StudioMembership[]>
  listOrganizationMemberships(input: {
    personId: string
    organizationId: string
    status?: OrganizationMembershipStatus
    limit: number
    cursorStatus?: OrganizationMembershipStatus
    cursorDisplayName?: string
    cursorMembershipId?: string
  }): Promise<OrganizationMembershipPage>
  listRoleCatalog(personId: string, organizationId: string): Promise<OrganizationRole[]>
  create(
    input: OrganizationCommand & {
      personId: string
      displayName: string
      typeCode: OrganizationTypeCode
      responsibleParty: { kind: 'natural_person' | 'legal_entity'; name: string }
    },
  ): Promise<CreatedOrganization>
  get(personId: string, organizationId: string, requestId: string): Promise<Organization>
  update(
    input: OrganizationCommand & {
      personId: string
      organizationId: string
      expectedRevision: number
      patch: {
        displayName?: string
        legalName?: string | null
        typeCode?: OrganizationTypeCode
      }
    },
  ): Promise<OrganizationCommandResult<Organization>>
  createSite(
    input: OrganizationCommand & {
      personId: string
      organizationId: string
      site: { name: string; address?: string | null }
    },
  ): Promise<OrganizationCommandResult<OrganizationSite>>
  updateSite(
    input: OrganizationCommand & {
      personId: string
      organizationId: string
      siteId: string
      expectedRevision: number
      patch: { name?: string; address?: string | null; status?: OrganizationSiteStatus }
    },
  ): Promise<OrganizationCommandResult<OrganizationSite>>
  transferOwnership(
    input: OrganizationCommand & {
      personId: string
      organizationId: string
      targetMembershipId: string
    },
  ): Promise<OrganizationCommandResult<OwnershipTransfer>>
  grantMembershipRole(
    input: OrganizationCommand & {
      personId: string
      organizationId: string
      membershipId: string
      roleCode: Exclude<OrganizationRoleCode, 'owner'>
    },
  ): Promise<OrganizationCommandResult<MembershipRoleGrant>>
}
