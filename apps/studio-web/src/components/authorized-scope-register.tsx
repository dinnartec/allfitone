'use client'

/**
 * HU-STUDIO-035 — what each person authorized us to see.
 *
 * The relationship card already answers this for one person. This answers it
 * for all of them, which is what somebody needs to know what they can count on
 * before opening anybody.
 *
 * **It shows the state of a permission and nothing the permission covers.**
 * Learning that somebody shared their health context is not reading their
 * health context, and no column here crosses that line — the E2E test pins the
 * exact set so the day a field with content is added, it fails.
 *
 * Criterion 2 is not decided here. A coach sees only the clients they attend
 * because the relationship's own row policy narrows the read, inside the
 * transaction; this screen renders whatever comes back and never second-guesses
 * it. Criterion 5 for the same reason: nothing on this page is cached as the
 * basis for an access — the page is a report, and the policy is resolved again
 * whenever somebody actually opens a person's data.
 */

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
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
import { Card, CardContent, CardHeader } from '@allfitone/react/components/card'

import { RegisterCardState } from '@/components/register-card-state'
import { WorkspacePageHeader } from '@/components/workspace-page-header'
import { useOrganizationContext } from './organization-context'
import { canViewClientDirectory, seesEveryClient } from '@/lib/client-directory'
import { useCompactTable } from '@/lib/use-compact-table'
import { StudioApiError, type AuthorizedScopeItem } from '@/lib/studio-api'
import {
  authorizedScopesQueryOptions,
  isStudioForbidden,
  organizationRolesQueryOptions,
} from '@/lib/studio-query'

const PAGE_SIZE = 50

type LoadError = 'forbidden' | 'stale-cursor' | 'unavailable'

export function AuthorizedScopeRegister() {
  const { current } = useOrganizationContext()
  const { compact, measuredRef } = useCompactTable<HTMLElement>()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const canView = canViewClientDirectory(current.roles, rolesQuery.data?.items)
  const everyClient = seesEveryClient(current.roles, rolesQuery.data?.items)
  const options = authorizedScopesQueryOptions(current.organization_id, PAGE_SIZE)
  const query = useInfiniteQuery({ ...options, enabled: canView })
  const forbidden = isStudioForbidden(query.error)
  const items = forbidden ? [] : (query.data?.pages.flatMap((page) => page.data) ?? [])
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

  if (!rolesQuery.isPending && !canView) {
    return (
      <section data-authorized-scope-page aria-label="Autorizaciones de clientes">
        <WorkspacePageHeader description="Lo que cada persona autorizó está disponible para quienes la atienden o administran la organización." />
        <Alert variant="warning">
          <AlertTitle>No tienes acceso a estas autorizaciones</AlertTitle>
          <AlertDescription>
            Tu rol en {current.display_name} no permite consultar lo que las personas vinculadas
            autorizaron.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const tableState = loading
    ? {
        state: 'loading' as const,
        title: 'Cargando autorizaciones',
        description: 'Estamos comprobando qué autorizó cada persona vinculada.',
      }
    : error === 'forbidden'
      ? {
          state: 'error' as const,
          title: 'No tienes acceso a estas autorizaciones',
          description: 'La organización o tus permisos ya no permiten consultar esta información.',
        }
      : error === 'unavailable' && items.length === 0
        ? {
            state: 'error' as const,
            title: 'No pudimos cargar las autorizaciones',
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
              title: everyClient
                ? 'Nadie ha autorizado nada todavía'
                : 'Todavía no te autorizaron nada',
              description: everyClient
                ? 'Cuando alguien acepte una invitación y elija qué compartir, lo verás aquí.'
                : 'Cuando una persona que atiendes decida qué compartir contigo, lo verás aquí.',
            }
          : undefined

  return (
    <section ref={measuredRef} data-authorized-scope-page aria-label="Autorizaciones de clientes">
      <WorkspacePageHeader
        description={
          everyClient
            ? `Consulta qué autorizó cada persona vinculada con ${current.display_name}, y desde cuándo.`
            : 'Consulta qué autorizó cada persona que atiendes, y desde cuándo.'
        }
      />

      {query.isFetching && !loading && !loadingMore ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando autorizaciones…
        </p>
      ) : null}

      {/* Five columns do not fit the space a narrow register has, so it gets the
          same data as cards. Only one presentation is rendered — see
          useCompactTable. */}
      {compact ? (
        <div
          data-authorized-scope-cards
          aria-label="Autorizaciones"
          aria-busy={loading || undefined}
        >
          {tableState ? (
            <RegisterCardState
              {...tableState}
              action={'action' in tableState ? tableState.action : undefined}
            />
          ) : (
            <ul data-authorized-scope-card-list>
              {items.map((entry) => (
                <li key={entry.grant_id}>
                  <AuthorizationCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <p data-authorized-scope-note>{REGISTER_NOTE}</p>
        </div>
      ) : (
        <Table
          aria-label="Autorizaciones"
          aria-busy={loading || loadingMore || undefined}
          scrollAreaLabel="Tabla de autorizaciones de clientes"
          data-studio-register="authorized-scopes"
        >
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <TableCaption>{REGISTER_NOTE}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Retirada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableState ? (
              <TableState colSpan={5} {...tableState} />
            ) : (
              items.map((entry) => <AuthorizationRow key={entry.grant_id} entry={entry} />)
            )}
          </TableBody>
        </Table>
      )}

      {error === 'stale-cursor' || (error === 'unavailable' && items.length > 0) ? (
        <Alert variant={error === 'stale-cursor' ? 'info' : 'danger'} live="polite">
          <AlertTitle>
            {error === 'stale-cursor'
              ? 'Las autorizaciones cambiaron'
              : 'No pudimos cargar más autorizaciones'}
          </AlertTitle>
          <AlertDescription>
            {error === 'stale-cursor'
              ? 'Actualiza la lista para verla desde el inicio.'
              : 'Las autorizaciones que ya cargaste permanecen visibles.'}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void retry()}>
              {error === 'stale-cursor' ? 'Actualizar la lista' : 'Reintentar'}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-authorized-scope-pagination>
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void query.fetchNextPage()}
          >
            {loadingMore ? <Spinner label="Cargando más autorizaciones" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/*
 * Criterion 3 said in the words a reader sees, not only enforced in the data:
 * the register names what was authorized and never shows it.
 */
const REGISTER_NOTE =
  'Esta vista dice qué autorizó cada persona, no lo que esa autorización ampara: ningún dato de entrenamiento, salud ni nutrición aparece aquí.'

function AuthorizationRow({ entry }: { entry: AuthorizedScopeItem }) {
  return (
    <TableRow>
      <TableCell>
        <strong>{entry.display_name}</strong>
      </TableCell>
      <TableCell>{entry.scope_display_name ?? entry.scope_code}</TableCell>
      <TableCell>
        <AuthorizationBadge status={entry.status} />
      </TableCell>
      <TableCell>{formatDate(entry.granted_at)}</TableCell>
      <TableCell>{entry.revoked_at ? formatDate(entry.revoked_at) : '—'}</TableCell>
    </TableRow>
  )
}

function AuthorizationCard({ entry }: { entry: AuthorizedScopeItem }) {
  return (
    <Card data-authorized-scope-card>
      <CardHeader>
        <div data-authorized-scope-person>
          <strong role="heading" aria-level={3}>
            {entry.display_name}
          </strong>
        </div>
      </CardHeader>
      <CardContent>
        {/* Same facts as the row, in the same order, each one named — as the
            team directory's cards do. */}
        <dl data-authorized-scope-facts>
          <dt>Categoría</dt>
          <dd>{entry.scope_display_name ?? entry.scope_code}</dd>

          <dt>Estado</dt>
          <dd>
            <AuthorizationBadge status={entry.status} />
          </dd>

          <dt>Desde</dt>
          <dd>{formatDate(entry.granted_at)}</dd>

          {entry.revoked_at ? (
            <>
              <dt>Retirada</dt>
              <dd>{formatDate(entry.revoked_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

/*
 * `frozen` is not an error and not a withdrawal: the relationship ended, so the
 * gym keeps what it was shown and receives nothing after. Calling it "retirada"
 * would blame the person for a decision the organization made.
 */
function AuthorizationBadge({ status }: { status: AuthorizedScopeItem['status'] }) {
  if (status === 'active') return <Badge variant="success">Vigente</Badge>
  if (status === 'revoked') return <Badge variant="secondary">Retirada</Badge>
  return <Badge variant="warning">Congelada</Badge>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
