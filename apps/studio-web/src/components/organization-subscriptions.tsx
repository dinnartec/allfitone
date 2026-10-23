'use client'

/**
 * Who pays the organization, and the three things it can do about it.
 *
 * Two rules worth knowing before editing.
 *
 * **Pausing is not revoking.** The command opens a reversible cause and touches no
 * permission, no assignment and no relationship. Every confirmation says so, and those
 * sentences are the behaviour rather than decoration: an administrator who believes
 * pausing takes the client's data away will either avoid the action or use it thinking it
 * does something it does not.
 *
 * **`manage_billing` or nothing.** A coach with that client assigned reads the same answer
 * as a stranger — the payment state of a person is not a training fact — so the screen is
 * closed for anybody without the capability, and PostgreSQL closes it again underneath.
 *
 * The list is never held long. The catalogue says it is "nunca cacheable para decidir
 * suspensión", and the reason is concrete: suspending on a stale row is how somebody loses
 * access over a charge that already cleared.
 */

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader } from '@allfitone/react/components/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@allfitone/react/components/dialog'
import { Spinner } from '@allfitone/react/components/spinner'
import { RegisterCardState } from '@/components/register-card-state'
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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import {
  actionLabel,
  availableActions,
  canManageBilling,
  confirmationDescription,
  confirmationTitle,
  formatAmount,
  formatPeriod,
  formatPeriodEnd,
  personInitials,
  refusalDescription,
  refusalFor,
  refusalTitle,
  statusLabel,
  type BillingRefusal,
  type SubscriptionAction,
} from '@/lib/organization-billing'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { OrganizationSubscription } from '@/lib/studio-api'
import { useCompactTable } from '@/lib/use-compact-table'
import {
  flattenSubscriptionPages,
  isStudioForbidden,
  organizationRolesQueryOptions,
  organizationSubscriptionsQueryOptions,
  studioQueryKeys,
  type SubscriptionFilter,
} from '@/lib/studio-query'

type LoadError = 'forbidden' | 'stale-cursor' | 'unavailable'

const PAGE_SIZE = 50
const BILLING_NOTE =
  'El cobro lo administra esta organización en su propia pasarela. Allfit refleja el estado del pago y nunca guarda datos de tarjeta.'

const FILTERS: ReadonlyArray<{ value: SubscriptionFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Al día' },
  { value: 'suspended', label: 'En pausa' },
  { value: 'ended', label: 'Terminadas' },
]

interface PendingAction {
  action: SubscriptionAction
  subscription: OrganizationSubscription
}

export function OrganizationSubscriptions() {
  const { current } = useOrganizationContext()
  const { compact, measuredRef } = useCompactTable<HTMLElement>()
  const queryClient = useQueryClient()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const canManage = canManageBilling(current.roles, rolesQuery.data?.items)
  const [filter, setFilter] = useState<SubscriptionFilter>('all')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [refusal, setRefusal] = useState<BillingRefusal | null>(null)

  const options = organizationSubscriptionsQueryOptions(current.organization_id, filter, PAGE_SIZE)
  const query = useInfiniteQuery({ ...options, enabled: canManage })
  const forbidden = isStudioForbidden(query.error)
  const items = forbidden ? [] : flattenSubscriptionPages(query.data)
  const loading = (canManage && query.isPending) || rolesQuery.isPending
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

  const transition = useMutation({
    mutationFn: ({ action, subscription }: PendingAction) => {
      const command = newCommand()
      const subscriptionId = subscription.subscription_id
      if (action === 'suspend') {
        return studioApi.suspendSubscription(current.organization_id, subscriptionId, command)
      }
      if (action === 'reactivate') {
        return studioApi.reactivateSubscription(current.organization_id, subscriptionId, command)
      }
      return studioApi.endSubscription(current.organization_id, subscriptionId, command)
    },
    onSuccess: async () => {
      setRefusal(null)
      setPending(null)
      /*
       * The whole subtree, not this one filter's page. A pause moves the row from "Al día"
       * to "En pausa", so the list the reader is looking at and the list behind the other
       * tab both stopped being true.
       */
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organizationSubscriptionsRoot(current.organization_id),
      })
    },
    onError: (cause) => {
      setRefusal(refusalFor(cause instanceof StudioApiError ? cause.status : undefined))
    },
  })

  async function retry(): Promise<void> {
    if (error === 'stale-cursor') {
      await queryClient.resetQueries({ queryKey: options.queryKey, exact: true })
      return
    }
    await query.refetch()
  }

  function changeFilter(values: SubscriptionFilter[]) {
    const nextFilter = values[0]
    if (!nextFilter || nextFilter === filter) return
    setFilter(nextFilter)
  }

  if (!rolesQuery.isPending && !canManage) {
    return (
      <section data-billing-page aria-label="Cobros de la organización">
        <WorkspacePageHeader description="Los cobros están disponibles para quienes administran la facturación de la organización." />
        <Alert variant="warning">
          <AlertTitle>No tienes acceso a los cobros</AlertTitle>
          <AlertDescription>
            Tu rol en {current.display_name} no incluye administrar cobros y suscripciones. Lo que
            paga una persona no es un dato de entrenamiento, así que no se comparte con quien la
            atiende.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const tableState = loading
    ? {
        state: 'loading' as const,
        title: 'Cargando cobros',
        description: 'Estamos comprobando quién paga en esta organización.',
      }
    : error === 'forbidden'
      ? {
          state: 'error' as const,
          title: 'No tienes acceso a los cobros',
          description: 'La organización o tus permisos ya no permiten consultar esta información.',
        }
      : error === 'unavailable' && items.length === 0
        ? {
            state: 'error' as const,
            title: 'No pudimos cargar los cobros',
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
              description: emptyDescription(filter),
            }
          : undefined

  return (
    <section ref={measuredRef} data-billing-page aria-label="Cobros de la organización">
      <WorkspacePageHeader
        description={`Consulta quién paga ${current.display_name} y en qué plan está cada persona.`}
      />

      <ToggleGroup
        value={[filter]}
        onValueChange={changeFilter}
        aria-label="Filtrar suscripciones por estado"
      >
        {FILTERS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {query.isFetching && !loading && !loadingMore ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando cobros…
        </p>
      ) : null}

      {/* Five columns do not fit the space a narrow register has, so it gets the
          same data as cards. Only one presentation is rendered — see
          useCompactTable. */}
      {compact ? (
        <div data-billing-cards aria-label="Suscripciones" aria-busy={loading || undefined}>
          {tableState ? (
            <RegisterCardState
              {...tableState}
              action={'action' in tableState ? tableState.action : undefined}
            />
          ) : (
            <ul data-billing-card-list>
              {items.map((subscription) => (
                <li key={subscription.subscription_id}>
                  <SubscriptionCard
                    subscription={subscription}
                    onAct={(action) => {
                      setRefusal(null)
                      setPending({ action, subscription })
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <p data-billing-note>{BILLING_NOTE}</p>
        </div>
      ) : (
        <Table
          aria-label="Suscripciones"
          aria-busy={loading || loadingMore || undefined}
          scrollAreaLabel="Tabla de suscripciones de la organización"
          data-studio-register="subscriptions"
        >
          {/* Filtering must not move the columns under the reader. */}
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <TableCaption>{BILLING_NOTE}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Próximo cobro</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableState ? (
              <TableState colSpan={5} {...tableState} />
            ) : (
              items.map((subscription) => (
                <SubscriptionRow
                  key={subscription.subscription_id}
                  subscription={subscription}
                  onAct={(action) => {
                    setRefusal(null)
                    setPending({ action, subscription })
                  }}
                />
              ))
            )}
          </TableBody>
        </Table>
      )}

      {error === 'stale-cursor' || (error === 'unavailable' && items.length > 0) ? (
        <Alert variant={error === 'stale-cursor' ? 'info' : 'danger'} live="polite">
          <AlertTitle>
            {error === 'stale-cursor' ? 'La lista cambió' : 'No pudimos cargar más cobros'}
          </AlertTitle>
          <AlertDescription>
            {error === 'stale-cursor'
              ? 'Actualiza la lista para verla desde el inicio.'
              : 'Las suscripciones que ya cargaste permanecen visibles.'}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void retry()}>
              {error === 'stale-cursor' ? 'Actualizar la lista' : 'Reintentar'}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {nextCursor ? (
        <div data-billing-pagination>
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void query.fetchNextPage()}
          >
            {loadingMore ? <Spinner label="Cargando más cobros" /> : null}
            {loadingMore ? 'Cargando…' : 'Ver más'}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          // Closing mid-flight would hide a request that is still going to land, and the
          // person has already been emailed by the time it does.
          if (transition.isPending) return
          if (!next) {
            setPending(null)
            setRefusal(null)
          }
        }}
      >
        <DialogContent data-billing-confirm>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirmationTitle(pending.action, pending.subscription.person_name)}
                </DialogTitle>
                <DialogDescription>{confirmationDescription(pending.action)}</DialogDescription>
              </DialogHeader>

              {refusal ? (
                <Alert variant="danger" live="assertive" data-billing-error>
                  <AlertTitle>{refusalTitle(pending.action, refusal)}</AlertTitle>
                  <AlertDescription>{refusalDescription(pending.action, refusal)}</AlertDescription>
                </Alert>
              ) : null}

              <DialogFooter>
                <DialogClose
                  render={<Button type="button" variant="ghost" disabled={transition.isPending} />}
                >
                  Cancelar
                </DialogClose>
                <Button
                  type="button"
                  variant={pending.action === 'end' ? 'destructive' : 'default'}
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(pending)}
                >
                  {transition.isPending ? (
                    <Spinner label={`${actionLabel(pending.action)} el plan`} />
                  ) : null}
                  {transition.isPending ? 'Aplicando…' : `${actionLabel(pending.action)} y avisar`}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SubscriptionRow({
  subscription,
  onAct,
}: {
  subscription: OrganizationSubscription
  onAct: (action: SubscriptionAction) => void
}) {
  return (
    <TableRow data-billing-row>
      <TableCell>
        <span data-billing-person>
          <Avatar decorative>
            <AvatarFallback>{personInitials(subscription.person_name)}</AvatarFallback>
          </Avatar>
          {subscription.person_name}
        </span>
      </TableCell>
      <TableCell>
        {subscription.plan_name}
        <span data-billing-amount>
          {formatAmount(subscription.amount_minor, subscription.currency_code)}{' '}
          {formatPeriod(subscription.billing_period)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={badgeVariant(subscription.status)}>
          {statusLabel(subscription.status)}
        </Badge>
      </TableCell>
      <TableCell>{formatPeriodEnd(subscription.current_period_end)}</TableCell>
      <TableCell>
        <SubscriptionActions subscription={subscription} onAct={onAct} />
      </TableCell>
    </TableRow>
  )
}

function SubscriptionCard({
  subscription,
  onAct,
}: {
  subscription: OrganizationSubscription
  onAct: (action: SubscriptionAction) => void
}) {
  return (
    <Card data-billing-card>
      <CardHeader>
        {/* The same `strong` the table row uses, carrying the heading role so a
            list of cards can be navigated by name. */}
        <div data-billing-person>
          <Avatar decorative>
            <AvatarFallback>{personInitials(subscription.person_name)}</AvatarFallback>
          </Avatar>
          <strong role="heading" aria-level={3}>
            {subscription.person_name}
          </strong>
        </div>
      </CardHeader>
      <CardContent>
        {/* Same facts as the row, in the same order, each one named — as the
            team directory's cards do. Three loose paragraphs sat here before,
            and CardContent spaces nothing, so the plan and the next charge were
            flush against each other and the state was a badge under the name
            with nothing saying it was a state. */}
        <dl data-billing-facts>
          <dt>Plan</dt>
          <dd>
            {subscription.plan_name} ·{' '}
            {formatAmount(subscription.amount_minor, subscription.currency_code)}{' '}
            {formatPeriod(subscription.billing_period)}
          </dd>

          <dt>Estado</dt>
          <dd>
            <Badge variant={badgeVariant(subscription.status)}>
              {statusLabel(subscription.status)}
            </Badge>
          </dd>

          <dt>Próximo cobro</dt>
          <dd>{formatPeriodEnd(subscription.current_period_end)}</dd>
        </dl>
        <SubscriptionActions subscription={subscription} onAct={onAct} />
      </CardContent>
    </Card>
  )
}

/**
 * Only the actions the command would accept. An ended subscription shows none at all
 * rather than a disabled button: there is nothing a reader could do to make it take one,
 * so a greyed-out control would only invite them to look for the reason.
 */
function SubscriptionActions({
  subscription,
  onAct,
}: {
  subscription: OrganizationSubscription
  onAct: (action: SubscriptionAction) => void
}) {
  const actions = availableActions(subscription.status)
  if (actions.length === 0) return null
  return (
    <span data-billing-actions>
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          size="sm"
          variant={action === 'end' ? 'ghost' : 'outline'}
          onClick={() => onAct(action)}
          data-billing-action={action}
        >
          {actionLabel(action)}
        </Button>
      ))}
    </span>
  )
}

function badgeVariant(status: OrganizationSubscription['status']) {
  if (status === 'active') return 'success' as const
  if (status === 'suspended') return 'warning' as const
  return 'secondary' as const
}

function emptyTitle(filter: SubscriptionFilter): string {
  if (filter === 'active') return 'Nadie está al día'
  if (filter === 'suspended') return 'Ningún plan está en pausa'
  if (filter === 'ended') return 'Ningún plan ha terminado'
  return 'Todavía nadie paga aquí'
}

function emptyDescription(filter: SubscriptionFilter): string {
  if (filter === 'all') {
    /*
     * Says where the next step is, and it is not here. A person subscribes from Space,
     * choosing one of the organization's published plans — this screen never creates a
     * subscription on somebody's behalf, because nobody can agree to a price for them.
     */
    return 'Las personas se suscriben desde la app, eligiendo uno de los planes publicados de la organización. Aquí verás cada plan en cuanto alguien lo tome.'
  }
  return 'Prueba con otro estado para ver el resto de las suscripciones.'
}
