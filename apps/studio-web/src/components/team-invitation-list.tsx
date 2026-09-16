'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@allfitone/react/components/alert-dialog'
import { Alert, AlertAction, AlertDescription } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader } from '@allfitone/react/components/card'
import { Empty, EmptyDescription, EmptyTitle } from '@allfitone/react/components/empty'
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
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { useStudioSessionMutation } from './studio-query-provider'
import { WorkspacePageHeader } from './workspace-page-header'
import { createCommandIntentManager } from '@/lib/command-intent'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type TeamInvitationPage,
  type TeamInvitationStatus,
} from '@/lib/studio-api'
import {
  flattenInvitationPages,
  isStudioForbidden,
  isStudioQuerySessionCancelled,
  organizationInvitationsQueryOptions,
  removeInvitationFromPages,
  studioQueryKeys,
} from '@/lib/studio-query'
import { canInviteTeam, invitationRoleLabel } from '@/lib/team-invitations'

type InvitationItem = TeamInvitationPage['data'][number]
type Filter = TeamInvitationStatus | 'all'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'completed', label: 'Decididas' },
  { value: 'revoked', label: 'Revocadas' },
  { value: 'expired', label: 'Vencidas' },
]
const INVITATION_ISSUANCE_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'

export function TeamInvitationList() {
  const { current } = useOrganizationContext()
  const compact = useCompactViewport()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [revokeIntent, setRevokeIntent] = useState<InvitationItem>()
  const [revokeError, setRevokeError] = useState<string>()
  const [revokeCommandIntent] = useState(() => createCommandIntentManager(newCommand))
  const options = organizationInvitationsQueryOptions(current.organization_id, filter, 50)
  const query = useInfiniteQuery(options)
  const forbidden = isStudioForbidden(query.error)
  const staleCursor =
    query.isFetchNextPageError &&
    query.error instanceof StudioApiError &&
    query.error.status === 422
  const items = forbidden ? [] : flattenInvitationPages(query.data)
  const loading = query.isPending
  const loadingMore = query.isFetchingNextPage
  const nextCursor =
    !staleCursor && query.hasNextPage ? (query.data?.pages.at(-1)?.page.next_cursor ?? null) : null
  const error = forbidden
    ? 'Tu rol actual no permite consultar las invitaciones.'
    : query.isError
      ? 'La conexión falló de forma temporal. Inténtalo de nuevo.'
      : undefined
  const revokeMutation = useStudioSessionMutation({
    mutationFn: (
      { invitationId, command }: { invitationId: string; command: CommandHeaders },
      signal,
    ) => studioApi.revokeTeamInvitation(current.organization_id, invitationId, command, signal),
    onSuccess: (_result, variables) => {
      queryClient.setQueriesData<InfiniteData<TeamInvitationPage, unknown>>(
        { queryKey: studioQueryKeys.organizationInvitationsRoot(current.organization_id) },
        (cached) => removeInvitationFromPages(cached, variables.invitationId),
      )
      return queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organizationInvitationsRoot(current.organization_id),
      })
    },
  })
  const revoking = revokeMutation.isPending ? revokeMutation.variables?.invitationId : undefined

  async function retryList(): Promise<void> {
    if (staleCursor) {
      await queryClient.resetQueries({ queryKey: options.queryKey, exact: true })
      return
    }
    await query.refetch()
  }

  function changeFilter(values: Filter[]) {
    const nextFilter = values[0]
    if (!nextFilter || nextFilter === filter) return
    setFilter(nextFilter)
  }

  function requestRevoke(item: InvitationItem) {
    if (revoking || item.status !== 'pending') return
    revokeCommandIntent.reset()
    setRevokeError(undefined)
    setRevokeIntent(item)
  }

  async function revoke() {
    const item = revokeIntent
    if (revoking || !item || item.status !== 'pending') return
    setRevokeError(undefined)
    const command = revokeCommandIntent.commandFor({
      operation: 'invitation:revoke',
      resourceId: item.id,
      payload: null,
    })
    try {
      await revokeMutation.mutateAsync({ invitationId: item.id, command })
      revokeCommandIntent.reset()
      setRevokeIntent(undefined)
    } catch (caught) {
      if (isStudioQuerySessionCancelled(caught)) {
        revokeCommandIntent.reset()
        setRevokeIntent(undefined)
        return
      }
      if (caught instanceof StudioApiError && caught.status === 409) {
        revokeCommandIntent.reset()
        void queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true })
        setRevokeError('La invitación ya fue decidida. Cierra este diálogo y actualiza la lista.')
      } else {
        setRevokeError('No pudimos revocar la invitación. Inténtalo de nuevo.')
      }
    }
  }

  // One derived state for the whole list. The error and the empty result used
  // to be independent conditions, so a failed load claimed both that we could
  // not read the invitations and that there were none.
  const listState = loading
    ? {
        state: 'loading' as const,
        title: 'Cargando invitaciones',
        description: 'Estamos comprobando las invitaciones de esta organización.',
      }
    : error && items.length === 0
      ? {
          state: 'error' as const,
          title: 'No pudimos cargar las invitaciones',
          description: error,
          action: (
            <Button size="sm" variant="outline" onClick={() => void retryList()}>
              Reintentar
            </Button>
          ),
        }
      : items.length === 0
        ? {
            state: 'empty' as const,
            title: emptyTitle(filter),
            description: 'Cambia el filtro para consultar otro estado de invitación.',
          }
        : undefined

  return (
    <section data-team-page aria-label="Invitaciones del equipo">
      <WorkspacePageHeader
        description="Consulta el destino, la propuesta y el estado de cada invitación."
        actions={
          INVITATION_ISSUANCE_ENABLED && canInviteTeam(current.roles) ? (
            <Link
              href={`/organizations/${current.organization_id}/team/invitations/new`}
              className={buttonVariants()}
            >
              Nueva invitación
            </Link>
          ) : null
        }
      />

      <ToggleGroup
        data-studio-filters
        value={[filter]}
        onValueChange={changeFilter}
        aria-label="Filtrar invitaciones por estado"
      >
        {FILTERS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {query.isFetching && !loading && !loadingMore ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando invitaciones…
        </p>
      ) : null}

      {/* Six columns do not fit a phone. The directory answered that with a
          card list and this one did not, so invitations were the section that
          scrolled sideways on a phone while its sibling did not. Only one
          presentation is rendered — see useCompactViewport. */}
      {compact ? (
        <div data-team-directory-cards aria-label="Invitaciones" aria-busy={loading || undefined}>
          {listState ? (
            <Empty>
              <EmptyTitle>{listState.title}</EmptyTitle>
              <EmptyDescription data-flush-text>{listState.description}</EmptyDescription>
            </Empty>
          ) : (
            <ul data-team-directory-card-list>
              {items.map((item) => (
                <li key={item.id}>
                  <InvitationCard item={item} revoking={revoking} onRevoke={requestRevoke} />
                </li>
              ))}
            </ul>
          )}
          <p data-team-directory-note>
            Las invitaciones muestran el destino propuesto y nunca datos fitness de una persona.
          </p>
        </div>
      ) : (
        <Table
          aria-label="Invitaciones"
          aria-busy={loading || loadingMore || undefined}
          scrollAreaLabel="Tabla de invitaciones de la organización"
          data-studio-register="invitations"
        >
          {/* A register must not redraw its own grid when it is filtered. With
              the layout fixed, these shares settle the columns once instead of
              letting whichever rows are showing settle them again. */}
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <TableCaption>
            Las invitaciones muestran el destino propuesto y nunca datos fitness de una persona.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Correo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Creada</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listState ? (
              <TableState colSpan={6} {...listState} />
            ) : (
              items.map((item) => (
                <InvitationRow
                  key={item.id}
                  item={item}
                  revoking={revoking}
                  onRevoke={requestRevoke}
                />
              ))
            )}
          </TableBody>
        </Table>
      )}

      {staleCursor || (error && items.length > 0) ? (
        <Alert variant={staleCursor ? 'info' : 'danger'} live="polite">
          <AlertDescription>
            {staleCursor
              ? 'Las invitaciones cambiaron. Actualiza la lista para verla desde el inicio.'
              : 'No pudimos actualizar la lista. Las invitaciones cargadas siguen visibles.'}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void retryList()}>
              {staleCursor ? 'Actualizar la lista' : 'Reintentar'}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-team-pagination>
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void query.fetchNextPage()}
          >
            {loadingMore ? <Spinner label="Cargando más invitaciones" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(revokeIntent)}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            revokeCommandIntent.reset()
            setRevokeIntent(undefined)
            setRevokeError(undefined)
          }
        }}
      >
        {/* `size="default"`, not `sm`. At `sm` the Design System keeps this
            header centred and its footer a two-column grid at every width,
            while the sibling `Dialog` in the same feature is left-aligned with
            a right-aligned footer — so the confirm modal read as coming from
            another product. */}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-flush-text>¿Revocar esta invitación?</AlertDialogTitle>
            <AlertDialogDescription data-flush-text>
              El enlace enviado a <strong>{revokeIntent?.contact}</strong> dejará de funcionar. Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError ? (
            <Alert variant="danger" live="assertive">
              <AlertDescription>{revokeError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(revoking)}>Conservar invitación</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(revoking)}
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
            >
              {revoking ? <Spinner label="Revocando invitación" /> : null}
              {revoking ? 'Revocando…' : 'Revocar invitación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/**
 * The table row stacked, the way the directory card is: the address identifies
 * the invitation, every other value keeps the name its column had, and the one
 * action a pending invitation offers closes the card.
 */
function InvitationCard({
  item,
  revoking,
  onRevoke,
}: {
  item: InvitationItem
  revoking: string | undefined
  onRevoke: (item: InvitationItem) => void
}) {
  const intent = item.intents[0]

  return (
    <Card data-team-member-card>
      <CardHeader>
        <strong role="heading" aria-level={3}>
          {item.contact}
        </strong>
      </CardHeader>
      <CardContent>
        <dl data-team-member-facts>
          <dt>Rol</dt>
          <dd>{intent ? invitationRoleLabel(intent.proposed_role_code) : '—'}</dd>

          <dt>Estado</dt>
          <dd>
            <InvitationStatusBadge status={item.status} />
          </dd>

          <dt>Creada</dt>
          <dd>{formatDate(item.created_at)}</dd>

          <dt>Vence</dt>
          <dd>{formatDate(item.expires_at)}</dd>
        </dl>
        {item.status === 'pending' ? (
          <div data-team-invitation-actions>
            <Button variant="outline" disabled={Boolean(revoking)} onClick={() => onRevoke(item)}>
              {revoking === item.id ? 'Revocando…' : 'Revocar'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function InvitationRow({
  item,
  revoking,
  onRevoke,
}: {
  item: InvitationItem
  revoking: string | undefined
  onRevoke: (item: InvitationItem) => void
}) {
  const intent = item.intents[0]

  return (
    <TableRow>
      <TableCell>{item.contact}</TableCell>
      <TableCell>{intent ? invitationRoleLabel(intent.proposed_role_code) : '—'}</TableCell>
      <TableCell>{formatDate(item.created_at)}</TableCell>
      <TableCell>{formatDate(item.expires_at)}</TableCell>
      <TableCell>
        <InvitationStatusBadge status={item.status} />
      </TableCell>
      <TableCell>
        {item.status === 'pending' ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(revoking)}
            onClick={() => onRevoke(item)}
          >
            {revoking === item.id ? 'Revocando…' : 'Revocar'}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function emptyTitle(filter: Filter): string {
  if (filter === 'all') return 'Todavía no hay invitaciones emitidas'
  const labels: Record<TeamInvitationStatus, string> = {
    pending: 'No hay invitaciones pendientes',
    completed: 'No hay invitaciones decididas',
    revoked: 'No hay invitaciones revocadas',
    expired: 'No hay invitaciones vencidas',
  }
  return labels[filter]
}

function InvitationStatusBadge({ status }: { status: TeamInvitationStatus }) {
  const labels: Record<TeamInvitationStatus, string> = {
    pending: 'Pendiente',
    completed: 'Decidida',
    revoked: 'Revocada',
    expired: 'Vencida',
  }
  return (
    <Badge
      // `outline` sets a transparent background over the base's transparent
      // border and so draws nothing: revoked and expired read as loose text
      // beside the two that are filled. Neither is an error, so both take the
      // neutral surface rather than `destructive`.
      variant={status === 'pending' ? 'warning' : status === 'completed' ? 'success' : 'secondary'}
    >
      {labels[status]}
    </Badge>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
}
