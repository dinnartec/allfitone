'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader } from '@allfitone/react/components/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableState,
} from '@allfitone/react/components/table'
import { ToggleGroup, ToggleGroupItem } from '@allfitone/react/components/toggle-group'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import { canViewTeamDirectory, memberInitials, organizationRoleLabel } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import {
  StudioApiError,
  type OrganizationMembership,
  type OrganizationMembershipStatus,
} from '@/lib/studio-api'
import {
  flattenMembershipPages,
  isStudioForbidden,
  organizationMembershipsQueryOptions,
} from '@/lib/studio-query'

type MembershipFilter = 'all' | OrganizationMembershipStatus
type LoadError = 'forbidden' | 'stale-cursor' | 'unavailable'

const PAGE_SIZE = 50
const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'
const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const FILTERS: ReadonlyArray<{ value: MembershipFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'terminated', label: 'Finalizados' },
]

export function TeamMembershipList() {
  const { current } = useOrganizationContext()
  const compact = useCompactViewport()
  const queryClient = useQueryClient()
  const canViewDirectory = canViewTeamDirectory(current.roles)
  const [filter, setFilter] = useState<MembershipFilter>('all')
  const options = organizationMembershipsQueryOptions(current.organization_id, filter, PAGE_SIZE)
  const query = useInfiniteQuery({ ...options, enabled: canViewDirectory })
  const forbidden = isStudioForbidden(query.error)
  const items = forbidden ? [] : flattenMembershipPages(query.data)
  const loading = canViewDirectory && query.isPending
  const loadingMore = query.isFetchingNextPage
  const staleCursor =
    query.isFetchNextPageError &&
    query.error instanceof StudioApiError &&
    query.error.status === 422
  const nextCursor =
    !staleCursor && query.hasNextPage ? (query.data?.pages.at(-1)?.page.next_cursor ?? null) : null
  const error: LoadError | undefined = forbidden
    ? 'forbidden'
    : staleCursor
      ? 'stale-cursor'
      : query.isError
        ? 'unavailable'
        : undefined

  async function retry(): Promise<void> {
    if (error === 'stale-cursor') {
      await queryClient.resetQueries({ queryKey: options.queryKey, exact: true })
      return
    }
    await query.refetch()
  }

  function changeFilter(values: MembershipFilter[]) {
    const nextFilter = values[0]
    if (!nextFilter || nextFilter === filter) return
    setFilter(nextFilter)
  }

  if (!canViewDirectory) {
    return (
      <section data-team-page aria-label="Directorio de integrantes">
        <WorkspacePageHeader description="El directorio del equipo está disponible para quienes administran membresías o pueden consultarlo." />
        <Alert variant="warning">
          <AlertTitle>No tienes acceso a este directorio</AlertTitle>
          <AlertDescription>
            Puedes consultar los roles y entender qué permite cada uno dentro de la organización.
          </AlertDescription>
          <Link
            href={`/organizations/${current.organization_id}/team/roles`}
            className={buttonVariants({ variant: 'outline' })}
          >
            Ver roles y permisos
          </Link>
        </Alert>
      </section>
    )
  }

  const tableState = loading
    ? {
        state: 'loading' as const,
        title: 'Cargando integrantes',
        description: 'Estamos comprobando las membresías de esta organización.',
      }
    : error === 'forbidden'
      ? {
          state: 'error' as const,
          title: 'No tienes acceso a este directorio',
          description: 'La organización o tus permisos ya no permiten consultar esta información.',
        }
      : error === 'unavailable' && items.length === 0
        ? {
            state: 'error' as const,
            title: 'No pudimos cargar el equipo',
            description: 'La conexión falló de forma temporal. Inténtalo de nuevo.',
            action: (
              <Button size="sm" variant="outline" onClick={() => void retry()}>
                Reintentar
              </Button>
            ),
          }
        : items.length === 0
          ? {
              state: 'empty' as const,
              title: emptyTitle(filter),
              description: 'Cambia el filtro para consultar otro estado de membresía.',
            }
          : undefined
  return (
    <section data-team-page aria-label="Directorio de integrantes">
      <WorkspacePageHeader
        description={`Consulta las membresías activas y finalizadas de ${current.display_name}.`}
        actions={
          INVITATIONS_ENABLED && canInviteTeam(current.roles) ? (
            <Link
              href={`/organizations/${current.organization_id}/team/invitations/new`}
              className={buttonVariants()}
            >
              Invitar integrante
            </Link>
          ) : null
        }
      />

      <ToggleGroup
        value={[filter]}
        onValueChange={changeFilter}
        aria-label="Filtrar integrantes por estado"
      >
        {FILTERS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {query.isFetching && !loading && !loadingMore ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando integrantes…
        </p>
      ) : null}

      {/* Five columns do not fit a phone, so narrow viewports get the same data
          as cards. Only one presentation is rendered — see useCompactViewport. */}
      {compact ? (
        <div data-team-directory-cards aria-label="Integrantes" aria-busy={loading || undefined}>
          {tableState ? (
            <Empty>
              <EmptyTitle>{tableState.title}</EmptyTitle>
              <EmptyDescription>{tableState.description}</EmptyDescription>
              {'action' in tableState && tableState.action ? (
                <EmptyContent>{tableState.action}</EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ul data-team-directory-card-list>
              {items.map((item) => (
                <li key={item.membership_id}>
                  <MembershipCard item={item} />
                </li>
              ))}
            </ul>
          )}
          <p data-team-directory-note>
            Esta vista presenta membresías organizacionales y no expone información de clientes ni
            datos fitness.
          </p>
        </div>
      ) : (
        <Table
          aria-label="Integrantes"
          aria-busy={loading || loadingMore || undefined}
          scrollAreaLabel="Tabla de integrantes de la organización"
        >
          <TableCaption>
            Esta vista presenta membresías organizacionales y no expone información de clientes ni
            datos fitness.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Integrante</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Ingreso</TableHead>
              <TableHead>Finalización</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableState ? (
              <TableState colSpan={5} {...tableState} />
            ) : (
              items.map((item) => <MembershipRow key={item.membership_id} item={item} />)
            )}
          </TableBody>
        </Table>
      )}

      {error === 'stale-cursor' || (error === 'unavailable' && items.length > 0) ? (
        <Alert variant={error === 'stale-cursor' ? 'info' : 'danger'} live="polite">
          <AlertTitle>
            {error === 'stale-cursor' ? 'El equipo cambió' : 'No pudimos cargar más integrantes'}
          </AlertTitle>
          <AlertDescription>
            {error === 'stale-cursor'
              ? 'Actualiza la lista para verla desde el inicio.'
              : 'Los integrantes que ya cargaste permanecen visibles.'}
          </AlertDescription>
          <Button size="sm" variant="outline" onClick={() => void retry()}>
            {error === 'stale-cursor' ? 'Actualizar la lista' : 'Reintentar'}
          </Button>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-team-pagination>
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void query.fetchNextPage()}
          >
            {loadingMore ? <Spinner label="Cargando más integrantes" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function MembershipCard({ item }: { item: OrganizationMembership }) {
  return (
    <Card data-team-member-card>
      <CardHeader>
        {/* The same `strong` the table row uses. CardTitle is the Design
            System's micro-caps label — 12px, extrabold, uppercase — which
            turned a person's name into a caption and left the badges beside it
            looking more important than the person. It carries the heading role
            so a list of cards can be navigated by name. */}
        <div data-team-member-identity>
          <Avatar decorative>
            <AvatarFallback>{memberInitials(item.display_name)}</AvatarFallback>
          </Avatar>
          <strong role="heading" aria-level={3}>
            {item.display_name}
          </strong>
        </div>
      </CardHeader>
      <CardContent>
        {/* The table names every column it shows. The card used to name one of
            them, so a badge reading "Propietario" sat next to a badge reading
            "Activo" with nothing saying which was a role and which a state.
            Same five facts as the row, in the same order, each one named. */}
        <dl data-team-member-facts>
          <dt>Estado</dt>
          <dd>
            <StatusBadge item={item} />
          </dd>

          <dt>Roles</dt>
          <dd>
            <RoleBadges item={item} />
          </dd>

          <dt>Ingreso</dt>
          <dd>{formatDate(item.joined_at)}</dd>

          {item.ended_at ? (
            <>
              <dt>Finalización</dt>
              <dd>{formatDate(item.ended_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

/**
 * The table and the card list are two presentations of one row, so how a status
 * or a role looks is decided once here. Keeping the choice in both is what let
 * them drift: the card was given its colours and the table kept the old ones.
 */
function StatusBadge({ item }: { item: OrganizationMembership }) {
  // `outline` sets a transparent background over the base's transparent border
  // and so draws nothing at all. Ended is not an error, so a neutral surface
  // says it without `destructive` overstating it.
  return (
    <Badge variant={item.status === 'active' ? 'success' : 'secondary'}>
      {item.status === 'active' ? 'Activo' : 'Terminado'}
    </Badge>
  )
}

/**
 * The accent family, not the semantic one: a role is not a state, and painting
 * an admin amber would claim a warning that is not there. It also brings the
 * directory closer to the catalog, which already marks roles in accent.
 */
function RoleBadges({ item }: { item: OrganizationMembership }) {
  return (
    <div data-team-role-badges>
      {item.roles.map((role) => (
        <Badge key={role} variant="default">
          {organizationRoleLabel(role)}
        </Badge>
      ))}
    </div>
  )
}

function MembershipRow({ item }: { item: OrganizationMembership }) {
  return (
    <TableRow>
      <TableCell>
        <div data-team-member-identity>
          <Avatar decorative>
            <AvatarFallback>{memberInitials(item.display_name)}</AvatarFallback>
          </Avatar>
          <strong>{item.display_name}</strong>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge item={item} />
      </TableCell>
      <TableCell>
        <RoleBadges item={item} />
      </TableCell>
      <TableCell>{formatDate(item.joined_at)}</TableCell>
      <TableCell>{item.ended_at ? formatDate(item.ended_at) : '—'}</TableCell>
    </TableRow>
  )
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}

function emptyTitle(filter: MembershipFilter): string {
  if (filter === 'active') return 'No hay membresías activas en esta vista'
  if (filter === 'terminated') return 'No hay membresías terminadas'
  return 'Todavía no hay integrantes para mostrar'
}
