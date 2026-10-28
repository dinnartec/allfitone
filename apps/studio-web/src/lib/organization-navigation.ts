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
  if (pathname === `${basePath}/clients/information-categories`) {
    return { title: 'Categorías de información' }
  }
  if (pathname === `${basePath}/clients/authorizations`) {
    return { title: 'Autorizaciones' }
  }
  /*
   * "Vínculo" because that is the word the directory already uses for this
   * thing — "Vínculo desde", "vínculos finalizados". The segment cannot be
   * `invitations`, `information-categories` or `authorizations`, which are
   * paths and not relationship ids; all are excluded here as well as matched
   * above, because a static route added below this one would otherwise be
   * titled "Vínculo".
   */
  if (
    /^\/organizations\/[^/]+\/clients\/(?!invitations$|information-categories$|authorizations$)[^/]+$/.test(
      pathname,
    )
  ) {
    return { title: 'Vínculo' }
  }
  // "Cobros" and not "Pagos": Allfit reflects the state of a payment and never processes
  // one, so the word for the screen is the gym's activity, not the transaction.
  if (pathname === `${basePath}/billing`) {
    return { title: 'Cobros' }
  }
  return { title: 'Studio' }
}
