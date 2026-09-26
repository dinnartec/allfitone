/**
 * Presentation rules for the organization screen.
 *
 * A site is never deleted, only withdrawn from service, so the screen always
 * has two groups to tell apart. Splitting them here keeps the component free
 * of the decision and lets the rule be tested without rendering anything.
 */
import type { OrganizationSite, OrganizationSiteStatus } from './studio-api'

export interface SitePartition {
  readonly active: readonly OrganizationSite[]
  readonly inactive: readonly OrganizationSite[]
}

export function partitionSites(sites: readonly OrganizationSite[]): SitePartition {
  return {
    active: sites.filter((site) => site.status === 'active'),
    inactive: sites.filter((site) => site.status === 'inactive'),
  }
}

export function siteStatusLabel(status: OrganizationSiteStatus): string {
  return status === 'active' ? 'Activa' : 'Inactiva'
}
