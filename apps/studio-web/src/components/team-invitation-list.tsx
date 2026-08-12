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
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Spinner } from '@allfitone/react/components/spinner'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useOrganizationContext } from './organization-context'
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
  const router = useRouter()
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
            : 'No pudimos cargar las invitaciones del equipo.',
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

  function changeFilter(nextFilter: Filter) {
    if (nextFilter === filter) return
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

  return (
    <section data-team-invitation-list aria-labelledby="team-invitations-title">
      <header data-team-invitation-list-header>
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Tu equipo</p>
          <h1 id="team-invitations-title">Invitaciones emitidas</h1>
          <p>Consulta el destino, la propuesta y el estado de cada invitación.</p>
        </div>
        {INVITATION_ISSUANCE_ENABLED && canInviteTeam(current.roles) ? (
          <Button
            onClick={() =>
              router.push(`/organizations/${current.organization_id}/team/invitations/new`)
            }
          >
            Nueva invitación
          </Button>
        ) : null}
      </header>

      <div data-team-invitation-filters aria-label="Filtrar invitaciones">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? 'default' : 'outline'}
            aria-pressed={filter === option.value}
            onClick={() => changeFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {error ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No se pudo completar la operación</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button variant="outline" onClick={() => void load()}>
            Actualizar
          </Button>
        </Alert>
      ) : null}

      {loading ? <p aria-live="polite">Cargando invitaciones…</p> : null}
      {!loading && items.length === 0 ? (
        <Alert>
          <AlertTitle>No hay invitaciones en este estado</AlertTitle>
          <AlertDescription>Las nuevas invitaciones aparecerán aquí.</AlertDescription>
        </Alert>
      ) : null}

      {items.length > 0 ? (
        <div data-team-invitation-table-wrapper>
          <table data-team-invitation-table>
            <thead>
              <tr>
                <th scope="col">Correo</th>
                <th scope="col">Rol</th>
                <th scope="col">Creada</th>
                <th scope="col">Vence</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const intent = item.intents[0]
                return (
                  <tr key={item.id}>
                    <td>{item.contact}</td>
                    <td>{intent ? invitationRoleLabel(intent.proposed_role_code) : '—'}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td>{formatDate(item.expires_at)}</td>
                    <td>
                      <InvitationStatusBadge status={item.status} />
                    </td>
                    <td>
                      {item.status === 'pending' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(revoking)}
                          onClick={() => requestRevoke(item)}
                        >
                          {revoking === item.id ? 'Revocando…' : 'Revocar'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {nextCursor ? (
        <Button variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor)}>
          {loadingMore ? 'Cargando…' : 'Ver más'}
        </Button>
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
