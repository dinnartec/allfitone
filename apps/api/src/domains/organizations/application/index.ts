import type { StudioActor } from '../../identity/index.js'
import type {
  OrganizationCommand,
  OrganizationDatabase,
  OrganizationMembershipStatus,
  OrganizationTypeCode,
} from '../domain/index.js'

export class StudioOrganizationError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioOrganizationError'
  }
}

export interface StudioOrganizationService {
  listTypes(actor: StudioActor): ReturnType<OrganizationDatabase['listTypes']>
  listMemberships(actor: StudioActor): ReturnType<OrganizationDatabase['listMemberships']>
  listOrganizationMemberships(
    actor: StudioActor,
    input: {
      organizationId: string
      status?: OrganizationMembershipStatus
      limit: number
      cursorStatus?: OrganizationMembershipStatus
      cursorDisplayName?: string
      cursorMembershipId?: string
    },
  ): ReturnType<OrganizationDatabase['listOrganizationMemberships']>
  listRoleCatalog(
    actor: StudioActor,
    organizationId: string,
  ): ReturnType<OrganizationDatabase['listRoleCatalog']>
  create(
    actor: StudioActor,
    input: OrganizationCommand & {
      displayName: string
      typeCode: OrganizationTypeCode
      responsibleParty: { kind: 'natural_person' | 'legal_entity'; name: string }
    },
  ): ReturnType<OrganizationDatabase['create']>
}

export function createStudioOrganizationService(
  database: OrganizationDatabase,
): StudioOrganizationService {
  const personId = (actor: StudioActor) => {
    if (!actor.personId) throw new StudioOrganizationError('registration-incomplete')
    return actor.personId
  }

  return {
    listTypes: (actor) => database.listTypes(personId(actor)),
    listMemberships: (actor) => database.listMemberships(personId(actor)),
    listOrganizationMemberships: (actor, input) =>
      database.listOrganizationMemberships({ personId: personId(actor), ...input }),
    listRoleCatalog: (actor, organizationId) =>
      database.listRoleCatalog(personId(actor), organizationId),
    create: (actor, input) => database.create({ personId: personId(actor), ...input }),
  }
}
