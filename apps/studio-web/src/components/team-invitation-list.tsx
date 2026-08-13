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
import { Alert, AlertDescription } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
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
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type TeamInvitationPage,
  type TeamInvitationStatus,
} from '@/lib/studio-api'
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
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<InvitationItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [revoking, setRevoking] = useState<string>()
  const [revokeIntent, setRevokeIntent] = useState<InvitationItem>()
  const [revokeError, setRevokeError] = useState<string>()
  const requestId = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  const load = useCallback(
    async (cursor?: string) => {
      requestController.current?.abort()
      const controller = new AbortController()
      const currentRequest = requestId.current + 1
      requestId.current = currentRequest
      requestController.current = controller
      if (cursor) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setLoadingMore(false)
        setItems([])
        setNextCursor(null)
      }
      setError(undefined)
      try {
        const page = await studioApi.teamInvitations(
          current.organization_id,
          {
            ...(filter === 'all' ? {} : { status: filter }),
            limit: 50,
            ...(cursor ? { cursor } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted || currentRequest !== requestId.current) return
        setItems((existing) => (cursor ? [...existing, ...page.data] : page.data))
        setNextCursor(page.page.next_cursor)
      } catch (caught) {
        if (controller.signal.aborted || currentRequest !== requestId.current) return
        setError(
          caught instanceof StudioApiError && caught.status === 403
            ? 'Tu rol actual no permite consultar las invitaciones.'
            : 'La conexión falló de forma temporal. Inténtalo de nuevo.',
        )
      } finally {
        if (!controller.signal.aborted && currentRequest === requestId.current) {
          requestController.current = null
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [current.organization_id, filter],
  )

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
      requestController.current?.abort()
    }
  }, [load])

  function changeFilter(values: Filter[]) {
    const nextFilter = values[0]
    if (!nextFilter || nextFilter === filter) return
    requestId.current += 1
    requestController.current?.abort()
    setItems([])
    setNextCursor(null)
    setError(undefined)
    setLoading(true)
    setLoadingMore(false)
    setFilter(nextFilter)
  }

  function requestRevoke(item: InvitationItem) {
    if (revoking || item.status !== 'pending') return
    setRevokeError(undefined)
    setRevokeIntent(item)
  }

  async function revoke() {
    const item = revokeIntent
    if (revoking || !item || item.status !== 'pending') return
    setRevoking(item.id)
    setRevokeError(undefined)
    try {
      await studioApi.revokeTeamInvitation(current.organization_id, item.id, newCommand())
      setItems((existing) =>
        existing.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                status: 'revoked',
                intents: candidate.intents.map((intent) => ({
                  ...intent,
                  status: 'revoked',
                  decided_at: new Date().toISOString(),
                })),
              }
            : candidate,
        ),
      )
      setRevokeIntent(undefined)
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 409) {
        setRevokeError('La invitación ya fue decidida. Cierra este diálogo y actualiza la lista.')
      } else {
        setRevokeError('No pudimos revocar la invitación. Inténtalo de nuevo.')
      }
    } finally {
      setRevoking(undefined)
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
    : error
      ? {
          state: 'error' as const,
          title: 'No pudimos cargar las invitaciones',
          description: error,
          action: (
            <Button size="sm" variant="outline" onClick={() => void load()}>
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

      <Table
        aria-label="Invitaciones"
        aria-busy={loading || loadingMore || undefined}
        scrollAreaLabel="Tabla de invitaciones de la organización"
      >
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

      {nextCursor ? (
        <div data-team-pagination>
          <Button variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor)}>
            {loadingMore ? <Spinner label="Cargando más invitaciones" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(revokeIntent)}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeIntent(undefined)
            setRevokeError(undefined)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar esta invitación?</AlertDialogTitle>
            <AlertDialogDescription>
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
      variant={status === 'pending' ? 'warning' : status === 'completed' ? 'success' : 'outline'}
    >
      {labels[status]}
    </Badge>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
}
