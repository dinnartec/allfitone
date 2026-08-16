'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@allfitone/react/components/card'
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
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import { canViewTeamDirectory, memberInitials, organizationRoleLabel } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import {
  StudioApiError,
  studioApi,
  type OrganizationMembership,
  type OrganizationMembershipStatus,
} from '@/lib/studio-api'

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
  const canViewDirectory = canViewTeamDirectory(current.roles)
  const [filter, setFilter] = useState<MembershipFilter>('all')
  const [items, setItems] = useState<OrganizationMembership[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(canViewDirectory)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<LoadError | undefined>()
  const requestId = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  const load = useCallback(
    async (cursor?: string) => {
      if (!canViewDirectory) return
      requestController.current?.abort()
      const controller = new AbortController()
      const currentRequest = requestId.current + 1
      requestId.current = currentRequest
      requestController.current = controller
      setError(undefined)
      if (cursor) setLoadingMore(true)
      else setLoading(true)

      try {
        const page = await studioApi.organizationMemberships(
          current.organization_id,
          {
            ...(filter === 'all' ? {} : { status: filter }),
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted || currentRequest !== requestId.current) return

        setItems((existing) => (cursor ? appendUnique(existing, page.data) : page.data))
        setNextCursor(page.page.next_cursor)
      } catch (caught) {
        if (controller.signal.aborted || currentRequest !== requestId.current) return
        if (caught instanceof StudioApiError && caught.status === 403) {
          setItems([])
          setNextCursor(null)
          setError('forbidden')
        } else if (cursor && caught instanceof StudioApiError && caught.status === 422) {
          setNextCursor(null)
          setError('stale-cursor')
        } else {
          setError('unavailable')
        }
      } finally {
        if (!controller.signal.aborted && currentRequest === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [canViewDirectory, current.organization_id, filter],
  )

  useEffect(() => {
    if (!canViewDirectory) {
      requestId.current += 1
      requestController.current?.abort()
      setLoading(false)
      return
    }
    setItems([])
    setNextCursor(null)
    setError(undefined)
    void load()
    return () => {
      requestId.current += 1
      requestController.current?.abort()
    }
  }, [canViewDirectory, load])

  function changeFilter(values: MembershipFilter[]) {
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
              <Button size="sm" variant="outline" onClick={() => void load()}>
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
  const soloOwner =
    !loading &&
    !error &&
    filter === 'all' &&
    nextCursor === null &&
    items.length === 1 &&
    items[0]?.membership_id === current.membership_id &&
    items[0].roles.includes('owner')

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

      {soloOwner ? (
        <aside data-solo-owner-note>
          <div>
            <strong>Tu espacio ya está listo para trabajar contigo.</strong>
            <p>Invita a alguien solo cuando vayas a sumar equipo.</p>
          </div>
          <Badge variant="outline">Opcional</Badge>
        </aside>
      ) : null}

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
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {error === 'stale-cursor' ? 'Actualizar la lista' : 'Reintentar'}
          </Button>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-team-pagination>
          <Button variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor)}>
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
      <CardHeader data-team-member-identity>
        <Avatar decorative>
          <AvatarFallback>{memberInitials(item.display_name)}</AvatarFallback>
        </Avatar>
        <CardTitle>{item.display_name}</CardTitle>
        <Badge variant={item.status === 'active' ? 'success' : 'outline'}>
          {item.status === 'active' ? 'Activo' : 'Terminado'}
        </Badge>
      </CardHeader>
      <CardContent>
        <div data-team-role-badges>
          {item.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {organizationRoleLabel(role)}
            </Badge>
          ))}
        </div>
        <dl data-team-member-dates>
          <div>
            <dt>Ingreso</dt>
            <dd>{formatDate(item.joined_at)}</dd>
          </div>
          {item.ended_at ? (
            <div>
              <dt>Finalización</dt>
              <dd>{formatDate(item.ended_at)}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
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
        <Badge variant={item.status === 'active' ? 'success' : 'outline'}>
          {item.status === 'active' ? 'Activo' : 'Terminado'}
        </Badge>
      </TableCell>
      <TableCell>
        <div data-team-role-badges>
          {item.roles.map((role) => (
            <Badge key={role} variant="secondary">
              {organizationRoleLabel(role)}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>{formatDate(item.joined_at)}</TableCell>
      <TableCell>{item.ended_at ? formatDate(item.ended_at) : '—'}</TableCell>
    </TableRow>
  )
}

function appendUnique(
  existing: OrganizationMembership[],
  incoming: OrganizationMembership[],
): OrganizationMembership[] {
  const ids = new Set(existing.map((item) => item.membership_id))
  return [...existing, ...incoming.filter((item) => !ids.has(item.membership_id))]
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}

function emptyTitle(filter: MembershipFilter): string {
  if (filter === 'active') return 'No hay membresías activas en esta vista'
  if (filter === 'terminated') return 'No hay membresías terminadas'
  return 'Todavía no hay integrantes para mostrar'
}
