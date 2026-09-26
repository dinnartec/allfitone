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
  return { title: 'Studio' }
}
