export type OrganizationTypeCode = 'professional_practice' | 'gym' | 'studio'

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
  roles: Array<'owner' | 'admin' | 'coach' | 'staff'>
}

export interface CreatedOrganization {
  id: string
  membershipId: string
  displayName: string
  typeCode: OrganizationTypeCode
  roles: Array<'owner'>
}

export interface OrganizationCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface OrganizationDatabase {
  listTypes(personId: string): Promise<OrganizationType[]>
  listMemberships(personId: string): Promise<StudioMembership[]>
  create(
    input: OrganizationCommand & {
      personId: string
      displayName: string
      typeCode: OrganizationTypeCode
      responsibleParty: { kind: 'natural_person' | 'legal_entity'; name: string }
    },
  ): Promise<CreatedOrganization>
}
