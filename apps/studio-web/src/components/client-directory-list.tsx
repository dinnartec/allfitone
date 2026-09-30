'use client'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader } from '@allfitone/react/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyTitle,
  EmptyContent,
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
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import {
  canViewClientDirectory,
  clientInitials,
  directoryEntryId,
  seesEveryClient,
} from '@/lib/client-directory'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import { StudioApiError, type ClientDirectoryItem } from '@/lib/studio-api'
import {
  flattenClientPages,
  isStudioForbidden,
  organizationClientsQueryOptions,
  organizationRolesQueryOptions,
  type ClientFilter,
} from '@/lib/studio-query'

type LoadError = 'forbidden' | 'stale-cursor' | 'unavailable'

const PAGE_SIZE = 50
const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

const FILTERS: ReadonlyArray<{ value: ClientFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'invited', label: 'Invitados' },
  { value: 'terminated', label: 'Finalizados' },
]

export function ClientDirectoryList() {
  const { current } = useOrganizationContext()
  const compact = useCompactViewport()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const canView = canViewClientDirectory(current.roles, rolesQuery.data?.items)
  const everyClient = seesEveryClient(current.roles, rolesQuery.data?.items)
  const [filter, setFilter] = useState<ClientFilter>('all')
  const options = organizationClientsQueryOptions(current.organization_id, filter, PAGE_SIZE)
  const query = useInfiniteQuery({ ...options, enabled: canView })
  const forbidden = isStudioForbidden(query.error)
  const items = forbidden ? [] : flattenClientPages(query.data)
  const loading = (canView && query.isPending) || rolesQuery.isPending
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

  function changeFilter(values: ClientFilter[]) {
    const nextFilter = values[0]
    if (!nextFilter || nextFilter === filter) return
    setFilter(nextFilter)
  }

  if (!rolesQuery.isPending && !canView) {
    return (
      <section data-client-page aria-label="Directorio de clientes">
        <WorkspacePageHeader description="El directorio de clientes está disponible para quienes atienden personas o administran la organización." />
        <Alert variant="warning">
          <AlertTitle>No tienes acceso a este directorio</AlertTitle>
          <AlertDescription>
            Tu rol en {current.display_name} no permite consultar las personas vinculadas.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const tableState = loading
    ? {
        state: 'loading' as const,
        title: 'Cargando clientes',
        description: 'Estamos comprobando las personas vinculadas con esta organización.',
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
            title: 'No pudimos cargar los clientes',
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
              title: emptyTitle(filter, everyClient),
              description: emptyDescription(filter),
            }
          : undefined

  return (
    <section data-client-page aria-label="Directorio de clientes">
      <WorkspacePageHeader
        description={
          everyClient
            ? `Consulta las personas vinculadas con ${current.display_name} y a quienes invitaron.`
            : 'Consulta las personas que atiendes y las invitaciones que enviaste.'
        }
      />

      <ToggleGroup
        value={[filter]}
        onValueChange={changeFilter}
        aria-label="Filtrar clientes por estado"
      >
        {FILTERS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {query.isFetching && !loading && !loadingMore ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando clientes…
        </p>
      ) : null}

      {/* Four columns do not fit a phone, so narrow viewports get the same data
          as cards. Only one presentation is rendered — see useCompactViewport. */}
      {compact ? (
        <div data-client-directory-cards aria-label="Clientes" aria-busy={loading || undefined}>
          {tableState ? (
            <Empty>
              <EmptyTitle>{tableState.title}</EmptyTitle>
              <EmptyDescription>{tableState.description}</EmptyDescription>
              {'action' in tableState && tableState.action ? (
                <EmptyContent>{tableState.action}</EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ul data-client-directory-card-list>
              {items.map((entry) => (
                <li key={directoryEntryId(entry)}>
                  <ClientCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <p data-client-directory-note>{DIRECTORY_NOTE}</p>
        </div>
      ) : (
        <Table
          aria-label="Clientes"
          aria-busy={loading || loadingMore || undefined}
          scrollAreaLabel="Tabla de clientes de la organización"
          data-studio-register="clients"
        >
          {/* Filtering must not move the columns under the reader. */}
          <colgroup>
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <TableCaption>{DIRECTORY_NOTE}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Finalización</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableState ? (
              <TableState colSpan={4} {...tableState} />
            ) : (
              items.map((entry) => <ClientRow key={directoryEntryId(entry)} entry={entry} />)
            )}
          </TableBody>
        </Table>
      )}

      {error === 'stale-cursor' || (error === 'unavailable' && items.length > 0) ? (
        <Alert variant={error === 'stale-cursor' ? 'info' : 'danger'} live="polite">
          <AlertTitle>
            {error === 'stale-cursor' ? 'El directorio cambió' : 'No pudimos cargar más clientes'}
          </AlertTitle>
          <AlertDescription>
            {error === 'stale-cursor'
              ? 'Actualiza la lista para verla desde el inicio.'
              : 'Los clientes que ya cargaste permanecen visibles.'}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void retry()}>
              {error === 'stale-cursor' ? 'Actualizar la lista' : 'Reintentar'}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-client-pagination>
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void query.fetchNextPage()}
          >
            {loadingMore ? <Spinner label="Cargando más clientes" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const DIRECTORY_NOTE =
  'Esta vista presenta el vínculo con cada persona y no expone ningún dato de entrenamiento, salud ni nutrición.'

function ClientCard({ entry }: { entry: ClientDirectoryItem }) {
  return (
    <Card data-client-card>
      <CardHeader>
        {/* The same `strong` the table row uses, carrying the heading role so a
            list of cards can be navigated by name. */}
        <div data-client-identity>
          <Avatar decorative>
            <AvatarFallback>
              {entry.kind === 'invitation' ? '@' : clientInitials(entry.display_name)}
            </AvatarFallback>
          </Avatar>
          <strong role="heading" aria-level={3}>
            {entry.kind === 'invitation' ? entry.contact_hint : entry.display_name}
          </strong>
        </div>
      </CardHeader>
      <CardContent>
        {/* Every fact is named, so a badge reading "Invitado" is never left
            beside a date with nothing saying what the date is. */}
        <dl data-client-facts>
          <dt>Estado</dt>
          <dd>
            <EntryStatusBadge entry={entry} />
          </dd>

          <dt>{entry.kind === 'invitation' ? 'Invitación enviada' : 'Vínculo desde'}</dt>
          <dd>{formatDate(entry.kind === 'invitation' ? entry.invited_at : entry.started_at)}</dd>

          {entry.kind === 'relationship' && entry.ended_at ? (
            <>
              <dt>Finalización</dt>
              <dd>{formatDate(entry.ended_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function ClientRow({ entry }: { entry: ClientDirectoryItem }) {
  return (
    <TableRow>
      <TableCell>
        <div data-client-identity>
          <Avatar decorative>
            <AvatarFallback>
              {entry.kind === 'invitation' ? '@' : clientInitials(entry.display_name)}
            </AvatarFallback>
          </Avatar>
          <strong>{entry.kind === 'invitation' ? entry.contact_hint : entry.display_name}</strong>
        </div>
      </TableCell>
      <TableCell>
        <EntryStatusBadge entry={entry} />
      </TableCell>
      <TableCell>
        {formatDate(entry.kind === 'invitation' ? entry.invited_at : entry.started_at)}
      </TableCell>
      <TableCell>
        {entry.kind === 'relationship' && entry.ended_at ? formatDate(entry.ended_at) : '—'}
      </TableCell>
    </TableRow>
  )
}

/**
 * The story asks for relationship state and invitation state. They are one
 * column rather than two because they never vary independently: a relationship
 * exists only because somebody accepted, so its invitation is always accepted,
 * and an entry that is still an invitation has no relationship yet. Two columns
 * would spend a whole column saying "aceptada" on every row that has a person.
 */
function EntryStatusBadge({ entry }: { entry: ClientDirectoryItem }) {
  if (entry.kind === 'invitation') {
    /*
     * "Invitado", not "Invitación pendiente". The column and the card label
     * both already say "Estado", so the longer wording spent its width
     * repeating them — and on a phone it did not fit, painting over the cell
     * beside it. One word, parallel with "Activo" and "Terminado", and the
     * same word the filter uses.
     *
     * Amber rather than success or danger: nobody has done anything wrong, the
     * person simply has not answered yet.
     */
    return <Badge variant="warning">Invitado</Badge>
  }
  return (
    <Badge variant={entry.relationship_status === 'active' ? 'success' : 'secondary'}>
      {entry.relationship_status === 'active' ? 'Activo' : 'Terminado'}
    </Badge>
  )
}

function emptyTitle(filter: ClientFilter, everyClient: boolean): string {
  if (filter === 'invited') return 'No hay invitaciones sin responder'
  if (filter === 'active') return 'No hay clientes activos'
  if (filter === 'terminated') return 'No hay vínculos finalizados'
  return everyClient ? 'Todavía no hay personas vinculadas' : 'Todavía no atiendes a nadie'
}

function emptyDescription(filter: ClientFilter): string {
  return filter === 'all'
    ? 'Cuando invites a alguien y acepte, aparecerá aquí.'
    : 'Cambia el filtro para consultar otro estado.'
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}
