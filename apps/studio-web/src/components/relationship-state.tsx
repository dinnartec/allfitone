'use client'

/**
 * How one relationship stands: the link, who attends the person, and which
 * permissions they granted.
 *
 * Two rules worth knowing before editing.
 *
 * **A permission is not the data it covers.** This screen names categories and
 * states and never reaches for content. Adding a field that shows what a
 * permission protects would break the story it implements.
 *
 * **A coach reads a narrower answer than an owner.** The row policy in
 * PostgreSQL shows a coach their own assignment and not the others, so an empty
 * substitutions panel can mean either "there are none" or "none that are yours
 * to see". The panel says which, because a reader who assumes the first would
 * read a missing substitution as a defect.
 */

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { FoundationIcon } from '@allfitone/react/icons'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { useOrganizationContext } from './organization-context'
import { RelationshipHolderChange } from './relationship-holder-change'
import { RelationshipHolderForm } from './relationship-holder-form'
import { WorkspacePageHeader } from './workspace-page-header'
import { clientInitials, seesEveryClient } from '@/lib/client-directory'
import {
  assignableCoaches,
  canAssignProfessionals,
  reassignableCoaches,
} from '@/lib/relationship-holder'
import {
  accessLevelLabel,
  grantStatusLabel,
  grantStatusTone,
  orderGrants,
  substitutionStatusLabel,
  substitutionStatusTone,
} from '@/lib/relationship-state'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import type {
  OrganizationMembership,
  RelationshipGrant,
  RelationshipState,
  RelationshipSubstitution,
} from '@/lib/studio-api'
import {
  flattenMembershipPages,
  isStudioForbidden,
  isStudioNotFound,
  organizationMembershipsQueryOptions,
  organizationRolesQueryOptions,
  relationshipQueryOptions,
} from '@/lib/studio-query'

const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
// One page is enough to choose from: a gym with more than fifty active coaches
// needs a search, which is a different story nobody has written.
const COACH_PAGE_SIZE = 50

export function RelationshipStateScreen() {
  const { current } = useOrganizationContext()
  const params = useParams<{ relationshipId: string }>()
  const compact = useCompactViewport()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const query = useQuery(relationshipQueryOptions(current.organization_id, params.relationshipId))
  const everyClient = seesEveryClient(current.roles, rolesQuery.data?.items)
  const mayAssign = canAssignProfessionals(current.roles, rolesQuery.data?.items)
  const directoryPath = `/organizations/${current.organization_id}/clients`
  /*
   * Only fetched for somebody who may assign, and only while nobody is in
   * charge. A reader of the relationship has no reason to pull the team roster
   * down, and the command would refuse them anyway.
   */
  const needsCoaches = mayAssign && query.data?.status === 'active'
  const coachesQuery = useInfiniteQuery({
    ...organizationMembershipsQueryOptions(current.organization_id, 'active', COACH_PAGE_SIZE),
    enabled: needsCoaches,
  })

  if (query.isPending) return <LoadingState />
  if (isStudioNotFound(query.error)) return <UnreachableState directoryPath={directoryPath} />
  if (isStudioForbidden(query.error)) return <DeniedState />
  if (!query.data) return <FailureState onRetry={() => void query.refetch()} />

  const relationship = query.data

  return (
    <div data-relationship-state>
      <WorkspacePageHeader
        description={
          relationship.status === 'active'
            ? `Cómo está el vínculo con ${relationship.display_name}, quién la atiende y qué permisos concedió.`
            : `Cómo quedó el vínculo con ${relationship.display_name}, quién la atendía y qué permisos concedió.`
        }
        actions={
          <Link
            href={directoryPath}
            data-slot="button"
            data-variant="outline"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Volver a clientes
          </Link>
        }
      />

      {query.isFetching ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando el estado del vínculo…
        </p>
      ) : null}

      <LinkPanel relationship={relationship} />
      <ProfessionalsPanel
        relationship={relationship}
        everyClient={everyClient}
        organizationId={current.organization_id}
        roster={
          needsCoaches
            ? {
                memberships: flattenMembershipPages(coachesQuery.data),
                loading: coachesQuery.isPending,
              }
            : null
        }
      />
      <GrantsPanel grants={relationship.grants} compact={compact} />
    </div>
  )
}

function LinkPanel({ relationship }: { relationship: RelationshipState }) {
  const active = relationship.status === 'active'
  return (
    <Card data-relationship-link>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          El vínculo
        </CardTitle>
        <CardDescription>
          Esta vista no cambia nada: ni el vínculo, ni quién atiende, ni los permisos.
        </CardDescription>
        <CardAction>
          <Badge variant={active ? 'success' : 'secondary'}>
            {active ? 'Activo' : 'Terminado'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* The person goes on her own full-width line, the way a directory card
            carries a name. Inside the label/value grid her name shared the row
            with the label and broke mid-word on a phone. */}
        <div data-client-identity data-relationship-subject>
          <Avatar decorative>
            <AvatarFallback>{clientInitials(relationship.display_name)}</AvatarFallback>
          </Avatar>
          <strong>{relationship.display_name}</strong>
        </div>
        <dl data-relationship-facts>
          <dt>Desde</dt>
          <dd>{formatDate(relationship.started_at)}</dd>

          {relationship.ended_at ? (
            <>
              <dt>Finalización</dt>
              <dd>{formatDate(relationship.ended_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function ProfessionalsPanel({
  relationship,
  everyClient,
  organizationId,
  roster,
}: {
  relationship: RelationshipState
  everyClient: boolean
  organizationId: string
  /* Only present for a reader who may assign, on a live relationship. */
  roster: { memberships: readonly OrganizationMembership[]; loading: boolean } | null
}) {
  const { holder, substitutions } = relationship
  const active = relationship.status === 'active'
  return (
    <Card data-relationship-professionals>
      <CardHeader>
        {/* Past tense once the link is over: "quién la atiende" on a terminated
            relationship claims somebody still does. */}
        <CardTitle role="heading" aria-level={2}>
          {active ? 'Quién la atiende' : 'Quién la atendía'}
        </CardTitle>
        <CardDescription>
          Estar a cargo no es tener permiso: sin el consentimiento de la persona, el profesional
          responsable no ve nada suyo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {holder ? (
          <div data-relationship-holder>
            <div data-relationship-holder-head>
              <div data-client-identity data-relationship-subject>
                <Avatar decorative>
                  <AvatarFallback>{clientInitials(holder.display_name)}</AvatarFallback>
                </Avatar>
                <strong>{holder.display_name}</strong>
              </div>
              {roster ? (
                <RelationshipHolderChange
                  organizationId={organizationId}
                  relationshipId={relationship.relationship_id}
                  currentHolderName={holder.display_name}
                  coaches={reassignableCoaches(roster.memberships, holder.membership_id)}
                  loadingCoaches={roster.loading}
                />
              ) : null}
            </div>
            <dl data-relationship-facts>
              <dt>Desde</dt>
              <dd>{formatDate(holder.valid_from)}</dd>
            </dl>
          </div>
        ) : roster ? (
          /*
           * One line and the form, not the empty block as well. The block's
           * description told the reader an administrator could assign somebody
           * — directly above the control that does exactly that, to the
           * administrator reading it. The state is worth saying; the
           * instruction is not.
           */
          <div data-relationship-assign-panel>
            <p data-relationship-unattended>Nadie la atiende todavía.</p>
            <RelationshipHolderForm
              organizationId={organizationId}
              relationshipId={relationship.relationship_id}
              coaches={assignableCoaches(roster.memberships)}
              loadingCoaches={roster.loading}
            />
          </div>
        ) : (
          /* Not an error and not an empty list: it is a person nobody was put in
             charge of, which is a state somebody has to resolve — and this
             reader cannot, so the block says who can. */
          <Empty data-relationship-no-holder>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoundationIcon name="organization" decorative />
              </EmptyMedia>
              <EmptyTitle>{active ? 'Nadie la atiende todavía' : 'Nadie quedó a cargo'}</EmptyTitle>
              <EmptyDescription>
                {active
                  ? 'Un administrador puede asignar al profesional responsable de este vínculo.'
                  : 'El vínculo terminó sin un profesional responsable registrado.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <div data-relationship-substitutions>
          <h3 data-relationship-subheading>Suplencias</h3>
          {substitutions.length === 0 ? (
            <p data-relationship-no-substitutions>
              {everyClient
                ? 'No hay suplencias registradas en este vínculo.'
                : /* The honest sentence for a coach. The policy shows them their
                     own assignment and not the others, so "no hay" would be a
                     claim this screen cannot make. */
                  'No ves suplencias de este vínculo. Tu rol muestra solo tu propia asignación, así que puede haber otras.'}
            </p>
          ) : (
            <ul data-relationship-substitution-list aria-label="Suplencias del vínculo">
              {substitutions.map((substitution) => (
                <SubstitutionRow key={substitution.assignment_id} substitution={substitution} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SubstitutionRow({ substitution }: { substitution: RelationshipSubstitution }) {
  return (
    <li data-relationship-substitution>
      <div data-relationship-substitution-identity>
        <strong>{substitution.display_name}</strong>
        <span data-relationship-substitution-window>{substitutionWindow(substitution)}</span>
      </div>
      <Badge variant={substitutionStatusTone(substitution.status)}>
        {substitutionStatusLabel(substitution.status)}
      </Badge>
    </li>
  )
}

/**
 * The permissions panel, and the one place where it would be easy to break the
 * story: every column here describes the permission — which category, which
 * version was agreed, whether it still stands — and none of them shows what the
 * permission protects.
 */
function GrantsPanel({
  grants,
  compact,
}: {
  grants: readonly RelationshipGrant[]
  compact: boolean
}) {
  const ordered = orderGrants(grants)
  const note = 'Lo que la persona aceptó compartir. Esta pantalla no muestra ningún dato suyo.'

  return (
    <Card data-relationship-grants>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Permisos concedidos
        </CardTitle>
        <CardDescription>
          Saber que existe un permiso no es leer lo que ampara. Aquí solo aparecen las categorías y
          su estado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <Empty data-relationship-no-grants>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoundationIcon name="organization" decorative />
              </EmptyMedia>
              <EmptyTitle>No concedió ningún permiso</EmptyTitle>
              <EmptyDescription>
                Es un resultado válido: alguien puede ser cliente del gimnasio sin que el gimnasio
                pueda leer nada suyo.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : compact ? (
          <ul data-relationship-grant-cards>
            {ordered.map((grant) => (
              <li key={grant.grant_id}>
                <GrantCard grant={grant} />
              </li>
            ))}
          </ul>
        ) : (
          <Table
            aria-label="Permisos concedidos"
            scrollAreaLabel="Tabla de permisos concedidos en este vínculo"
            data-studio-register="grants"
          >
            <colgroup>
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <TableCaption>{note}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Permiso</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((grant) => (
                <TableRow key={grant.grant_id}>
                  <TableCell>
                    <div data-relationship-grant-identity>
                      <strong>{grant.display_name ?? grant.scope_code}</strong>
                      <span data-relationship-grant-version>{versionLabel(grant)}</span>
                    </div>
                  </TableCell>
                  <TableCell>{accessLevelLabel(grant.access_level)}</TableCell>
                  <TableCell>
                    <Badge variant={grantStatusTone(grant.status)}>
                      {grantStatusLabel(grant.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(grant.granted_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {ordered.length > 0 && compact ? <p data-relationship-grant-note>{note}</p> : null}
      </CardContent>
    </Card>
  )
}

function GrantCard({ grant }: { grant: RelationshipGrant }) {
  return (
    <Card data-relationship-grant-card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          {grant.display_name ?? grant.scope_code}
        </CardTitle>
        <CardAction>
          <Badge variant={grantStatusTone(grant.status)}>{grantStatusLabel(grant.status)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl data-relationship-facts>
          <dt>Alcance</dt>
          <dd>{accessLevelLabel(grant.access_level)}</dd>

          <dt>Versión</dt>
          <dd>{versionLabel(grant)}</dd>

          <dt>Desde</dt>
          <dd>{formatDate(grant.granted_at)}</dd>

          {/* "Hasta", not "Retirado": the badge above already says the state, so
              repeating the word left the card saying "Retirado" twice, once as a
              state and once as a date. Paired with "Desde" it reads as the
              window the permission covered, which is what the date is. */}
          {grant.revoked_at ? (
            <>
              <dt>Hasta</dt>
              <dd>{formatDate(grant.revoked_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <div data-relationship-state data-relationship-loading>
      <Skeleton data-relationship-header-placeholder />
      <Skeleton data-relationship-card-placeholder />
      <Skeleton data-relationship-card-placeholder />
    </div>
  )
}

/**
 * Absent, or not ours to read. The copy commits to neither on purpose: telling a
 * coach that the relationship exists but is not theirs would reveal that the
 * organization has that person as a client.
 */
function UnreachableState({ directoryPath }: { directoryPath: string }) {
  return (
    <div data-relationship-state>
      <Empty data-relationship-unreachable>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FoundationIcon name="organization" decorative />
          </EmptyMedia>
          <EmptyTitle>No encontramos este vínculo</EmptyTitle>
          <EmptyDescription>
            Puede que no exista o que no esté entre los que atiendes. Vuelve a clientes para elegir
            otro.
          </EmptyDescription>
        </EmptyHeader>
        <Link
          href={directoryPath}
          data-slot="button"
          data-variant="outline"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Volver a clientes
        </Link>
      </Empty>
    </div>
  )
}

// A denial, not an outage: a retry here would offer something that cannot
// succeed.
function DeniedState() {
  return (
    <div data-relationship-state>
      <Alert variant="danger" live="polite" data-relationship-denied>
        <AlertTitle>No puedes consultar este vínculo</AlertTitle>
        <AlertDescription>
          Tu rol en esta organización no incluye el directorio de clientes. Puedes seguir trabajando
          en las demás secciones.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function FailureState({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-relationship-state>
      <Alert variant="danger" live="polite" data-relationship-failure>
        <AlertTitle>No pudimos cargar el estado del vínculo</AlertTitle>
        <AlertDescription>
          La conexión falló de forma temporal. El vínculo y sus permisos siguen intactos.
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

/**
 * The version is shown because the story asks for it, and said as a sentence
 * rather than a bare number: "v2" beside a permission name invites the reader to
 * wonder what happened to v1.
 */
function versionLabel(grant: RelationshipGrant): string {
  return `Versión ${grant.version_number} del permiso`
}

function substitutionWindow(substitution: RelationshipSubstitution): string {
  const from = formatDate(substitution.valid_from)
  return substitution.ends_on
    ? `Del ${from} al ${formatCalendarDay(substitution.ends_on)}`
    : `Desde ${from}`
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}

/**
 * `ends_on` is a day in the gym's calendar, not an instant, and it arrives as
 * `YYYY-MM-DD`. Handing that to `new Date` reads it as midnight UTC, which in
 * Colombia renders as **the day before** — a substitution ending on the 12th
 * would be shown ending on the 11th. Building the date from its parts keeps it
 * local.
 */
function formatCalendarDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return DATE_FORMATTER.format(new Date(year, month - 1, day))
}
