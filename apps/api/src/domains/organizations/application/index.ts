import type { AccountActor } from '../../identity/index.js'
import type {
  OrganizationCommand,
  OrganizationDatabase,
  OrganizationMembershipStatus,
  OrganizationRoleCode,
  OrganizationSiteStatus,
  OrganizationTypeCode,
} from '../domain/index.js'

export class StudioOrganizationError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioOrganizationError'
  }
}

export interface StudioOrganizationService {
  listTypes(actor: AccountActor): ReturnType<OrganizationDatabase['listTypes']>
  listMemberships(actor: AccountActor): ReturnType<OrganizationDatabase['listMemberships']>
  listOrganizationMemberships(
    actor: AccountActor,
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
    actor: AccountActor,
    organizationId: string,
  ): ReturnType<OrganizationDatabase['listRoleCatalog']>
  create(
    actor: AccountActor,
    input: OrganizationCommand & {
      displayName: string
      typeCode: OrganizationTypeCode
      responsibleParty: { kind: 'natural_person' | 'legal_entity'; name: string }
    },
  ): ReturnType<OrganizationDatabase['create']>
  get(
    actor: AccountActor,
    organizationId: string,
    requestId: string,
  ): ReturnType<OrganizationDatabase['get']>
  update(
    actor: AccountActor,
    input: OrganizationCommand & {
      organizationId: string
      expectedRevision: number
      patch: {
        displayName?: string
        legalName?: string | null
        typeCode?: OrganizationTypeCode
      }
    },
  ): ReturnType<OrganizationDatabase['update']>
  createSite(
    actor: AccountActor,
    input: OrganizationCommand & {
      organizationId: string
      site: { name: string; address?: string | null }
    },
  ): ReturnType<OrganizationDatabase['createSite']>
  updateSite(
    actor: AccountActor,
    input: OrganizationCommand & {
      organizationId: string
      siteId: string
      expectedRevision: number
      patch: { name?: string; address?: string | null; status?: OrganizationSiteStatus }
    },
  ): ReturnType<OrganizationDatabase['updateSite']>
  transferOwnership(
    actor: AccountActor,
    input: OrganizationCommand & { organizationId: string; targetMembershipId: string },
  ): ReturnType<OrganizationDatabase['transferOwnership']>
  grantMembershipRole(
    actor: AccountActor,
    input: OrganizationCommand & {
      organizationId: string
      membershipId: string
      roleCode: Exclude<OrganizationRoleCode, 'owner'>
    },
  ): ReturnType<OrganizationDatabase['grantMembershipRole']>
}

export function createStudioOrganizationService(
  database: OrganizationDatabase,
): StudioOrganizationService {
  const personId = (actor: AccountActor) => {
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
    get: (actor, organizationId, requestId) =>
      database.get(personId(actor), organizationId, requestId),
    update: (actor, input) => database.update({ personId: personId(actor), ...input }),
    createSite: (actor, input) => database.createSite({ personId: personId(actor), ...input }),
    updateSite: (actor, input) => database.updateSite({ personId: personId(actor), ...input }),
    transferOwnership: (actor, input) =>
      database.transferOwnership({ personId: personId(actor), ...input }),
    grantMembershipRole: (actor, input) =>
      database.grantMembershipRole({ personId: personId(actor), ...input }),
  }
}
