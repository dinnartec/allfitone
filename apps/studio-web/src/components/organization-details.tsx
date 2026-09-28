'use client'

/**
 * The organization as its own members read it: identity, legal name, type and
 * the sites it operates from. Read-only by design — every write in this area
 * belongs to a story of its own.
 *
 * The one rule worth knowing before editing: a missing organization and one
 * this account has no membership in must render the same screen. PostgreSQL
 * already answers both with the same error, and telling them apart here would
 * hand anyone a way to probe which organizations exist.
 */

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import { Skeleton } from '@allfitone/react/components/skeleton'
import { StatStrip, StatStripItem } from '@allfitone/react/components/stat-strip'
import { FoundationIcon } from '@allfitone/react/icons'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { organizationTypeLabel } from './membership-selector'
import { useOrganizationContext } from './organization-context'
import { partitionSites, siteStatusLabel } from '@/lib/organization-details'
import { canManageSites } from '@/lib/organization-sites'
import type { OrganizationSite } from '@/lib/studio-api'
import {
  isStudioForbidden,
  isStudioNotFound,
  organizationQueryOptions,
  organizationRolesQueryOptions,
} from '@/lib/studio-query'

const LEGAL_NAME_ABSENT = 'Sin razón social registrada'

export function OrganizationDetails() {
  const { current } = useOrganizationContext()
  const query = useQuery(organizationQueryOptions(current.organization_id))
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const organization = query.data

  if (query.isPending) return <LoadingState />
  if (isStudioNotFound(query.error)) return <UnreachableState />
  if (isStudioForbidden(query.error)) return <DeniedState />
  if (!organization) return <FailureState onRetry={() => void query.refetch()} />

  const sites = partitionSites(organization.sites)

  return (
    <div data-organization-details>
      {query.isFetching ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando los datos de la organización…
        </p>
      ) : null}

      {/* No title of its own: the workspace bar above already carries the h1
          for this route, and a second one repeated the word it was reading. */}
      <Card data-organization-identity>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Datos
          </CardTitle>
          <CardDescription>
            Así identifica Allfit a tu organización. Esta vista no cambia roles ni permisos.
          </CardDescription>
          <CardAction>
            <Badge variant={organization.status === 'active' ? 'success' : 'secondary'}>
              {organization.status === 'active' ? 'Activa' : 'Cerrada'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl data-organization-facts>
            <DetailFact label="Nombre" value={organization.display_name} />
            <DetailFact
              label="Razón social"
              value={organization.legal_name ?? LEGAL_NAME_ABSENT}
              absent={organization.legal_name === null}
            />
            <DetailFact label="Tipo" value={organizationTypeLabel(organization.type_code)} />
          </dl>
        </CardContent>
      </Card>

      <SitesPanel
        sites={sites}
        total={organization.sites.length}
        newSitePath={
          canManageSites(current.roles, rolesQuery.data?.items)
            ? `/organizations/${current.organization_id}/organization/sites/new`
            : null
        }
      />
    </div>
  )
}

function SitesPanel({
  sites,
  total,
  newSitePath,
}: {
  sites: ReturnType<typeof partitionSites>
  total: number
  newSitePath: string | null
}) {
  return (
    <Card data-organization-sites>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Sedes
        </CardTitle>
        <CardDescription>Los lugares desde los que opera tu organización.</CardDescription>
        {/* Only for a role the server would accept. Offering it to everyone
            would spend a click to reach a refusal. */}
        {newSitePath ? (
          <CardAction>
            <Link
              href={newSitePath}
              data-slot="button"
              data-variant="outline"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Registrar sede
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoundationIcon name="organization" decorative />
              </EmptyMedia>
              <EmptyTitle>Aún no hay sedes registradas</EmptyTitle>
              <EmptyDescription>
                Cuando registres una sede aparecerá aquí con su dirección y su estado.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* Two figures, so the strip shares the row the way the account
                screen does. Withdrawn sites still count: they are the reason
                a site never disappears from this list. */}
            <div data-organization-signals data-signals-multiple>
              <StatStrip>
                <StatStripItem value={sites.active.length} label="Sedes activas" />
                <StatStripItem value={sites.inactive.length} label="Sedes inactivas" />
              </StatStrip>
            </div>
            <ul data-organization-site-list aria-label="Sedes de la organización">
              {[...sites.active, ...sites.inactive].map((site) => (
                <SiteRow key={site.id} site={site} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SiteRow({ site }: { site: OrganizationSite }) {
  return (
    <li
      data-organization-site
      {...(site.status === 'inactive' ? { 'data-site-inactive': '' } : {})}
    >
      <div data-organization-site-identity>
        <strong>{site.name}</strong>
        <span data-organization-site-address>{site.address ?? 'Sin dirección registrada'}</span>
      </div>
      <Badge variant={site.status === 'active' ? 'success' : 'secondary'}>
        {siteStatusLabel(site.status)}
      </Badge>
    </li>
  )
}

function DetailFact({
  label,
  value,
  absent = false,
}: {
  label: string
  value: string
  absent?: boolean
}) {
  return (
    <div data-organization-fact>
      <dt>{label}</dt>
      <dd {...(absent ? { 'data-fact-absent': '' } : {})}>{value}</dd>
    </div>
  )
}

function LoadingState() {
  return (
    <div data-organization-details data-organization-loading>
      <Skeleton data-organization-details-placeholder />
      <Skeleton data-organization-card-placeholder />
      <Skeleton data-organization-card-placeholder />
    </div>
  )
}

/**
 * Absent, or not ours to read. The copy deliberately commits to neither: see
 * the note at the top of this file.
 */
function UnreachableState() {
  return (
    <div data-organization-details>
      <Empty data-organization-unreachable>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FoundationIcon name="organization" decorative />
          </EmptyMedia>
          <EmptyTitle>No encontramos esta organización</EmptyTitle>
          <EmptyDescription>
            Puede que ya no exista o que tu vinculación haya terminado. Elige otra desde Mis
            espacios.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

// A denial, not an outage: offering a retry here would offer something that
// cannot succeed.
function DeniedState() {
  return (
    <div data-organization-details>
      <Alert variant="danger" live="polite" data-organization-denied>
        <AlertTitle>No puedes consultar estos datos</AlertTitle>
        <AlertDescription>
          Tu rol en esta organización no incluye esta vista. Puedes seguir trabajando en las demás
          secciones.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function FailureState({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-organization-details>
      <Alert variant="danger" live="polite" data-organization-failure>
        <AlertTitle>No pudimos cargar los datos de tu organización</AlertTitle>
        <AlertDescription>
          La conexión falló de forma temporal. Los datos siguen intactos.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        </AlertAction>
      </Alert>
    </div>
  )
}
