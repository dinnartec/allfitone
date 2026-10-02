export interface WorkspaceRouteMetadata {
  title: string
}

export function resolveWorkspaceRoute(
  pathname: string,
  organizationId: string,
): WorkspaceRouteMetadata {
  const basePath = `/organizations/${organizationId}`
  const teamPath = `${basePath}/team`
  const invitationPath = `${teamPath}/invitations`

  if (pathname === basePath) {
    return { title: 'Inicio' }
  }
  if (pathname === `${basePath}/organization`) {
    return { title: 'Organización' }
  }
  if (pathname === `${basePath}/organization/sites/new`) {
    return { title: 'Nueva sede' }
  }
  if (/^\/organizations\/[^/]+\/organization\/sites\/[^/]+$/.test(pathname)) {
    return { title: 'Editar sede' }
  }
  if (pathname === teamPath) {
    return { title: 'Integrantes' }
  }
  if (pathname === invitationPath) {
    return { title: 'Invitaciones' }
  }
  if (pathname === `${invitationPath}/new`) {
    return { title: 'Nueva invitación' }
  }
  if (pathname === `${teamPath}/roles`) {
    return { title: 'Roles y permisos' }
  }
  if (pathname === `${basePath}/clients`) {
    return { title: 'Clientes' }
  }
  if (pathname === `${basePath}/clients/invitations/new`) {
    return { title: 'Invitar cliente' }
  }
  return { title: 'Studio' }
}
