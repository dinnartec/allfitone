'use client'

/**
 * What a relationship has been through, newest first.
 *
 * It lives apart from the relationship screen because the two answer different
 * questions — how it stands, and how it got there — and because this one is a
 * page of an unbounded list rather than a fixed set of panels.
 *
 * The line that justifies the screen is the change of professional. Since
 * AFO-129 an administrator can replace whoever attends a client, and until now
 * nothing showed that it had happened: reading the relationship simply named
 * somebody else than it did last week. A change in who may read a person's data
 * that leaves no trace is what this closes.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import {
  Card,
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
import { Spinner } from '@allfitone/react/components/spinner'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { FoundationIcon } from '@allfitone/react/icons'

import { WorkspacePageHeader } from '@/components/workspace-page-header'
import { useOrganizationContext } from '@/components/organization-context'
import { seesEveryClient } from '@/lib/client-directory'
import { endedElsewhereNote, endedReason, historyEventTitle } from '@/lib/relationship-history'
import type { RelationshipHistoryEvent } from '@/lib/studio-api'
import {
  isStudioForbidden,
  isStudioNotFound,
  organizationRolesQueryOptions,
  relationshipHistoryQueryOptions,
  relationshipQueryOptions,
} from '@/lib/studio-query'

const PAGE_SIZE = 25
const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
const TIME_FORMATTER = new Intl.DateTimeFormat('es-CO', { timeStyle: 'short' })

export function RelationshipHistoryScreen() {
  const { current } = useOrganizationContext()
  const params = useParams<{ relationshipId: string }>()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  /*
   * The relationship is read for one thing: whose history this is. The server
   * does not repeat the person on every page, and this query is already warm
   * from the screen the reader came through.
   */
  const relationshipQuery = useQuery(
    relationshipQueryOptions(current.organization_id, params.relationshipId),
  )
  const historyQuery = useInfiniteQuery(
    relationshipHistoryQueryOptions(current.organization_id, params.relationshipId, PAGE_SIZE),
  )

  const relationshipPath = `/organizations/${current.organization_id}/clients/${params.relationshipId}`
  const everyClient = seesEveryClient(current.roles, rolesQuery.data?.items)

  if (historyQuery.isPending || relationshipQuery.isPending) return <LoadingState />
  if (isStudioNotFound(historyQuery.error)) {
    return <UnreachableState directoryPath={`/organizations/${current.organization_id}/clients`} />
  }
  if (isStudioForbidden(historyQuery.error)) return <DeniedState />
  if (!historyQuery.data) return <FailureState onRetry={() => void historyQuery.refetch()} />

  const personName = relationshipQuery.data?.display_name ?? 'esta persona'
  const events = historyQuery.data.pages.flatMap((page) => page.data)

  return (
    <div data-relationship-history>
      <WorkspacePageHeader
        description={`Lo que ha pasado en el vínculo con ${personName}, de lo más reciente a lo más antiguo.`}
        actions={
          <Link
            href={relationshipPath}
            data-slot="button"
            data-variant="outline"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Volver al vínculo
          </Link>
        }
      />

      {/*
       * Said before the list, not after it. The row policy shows a coach only
       * their own assignment, so a coach genuinely reads a shorter history — and
       * a short list with no explanation reads as a complete one.
       */}
      {everyClient ? null : (
        <Alert data-relationship-history-partial>
          <AlertTitle>Ves tu parte de esta historia</AlertTitle>
          <AlertDescription>
            Como coach ves lo tuyo y lo que la persona decidió. Quién la atendía antes de ti no
            aparece aquí.
          </AlertDescription>
        </Alert>
      )}

      <Card data-relationship-history-card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Historia del vínculo
          </CardTitle>
          <CardDescription>
            Un registro de lo que ocurrió y cuándo. No muestra ningún dato de la persona, solo los
            hechos del vínculo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <Empty data-relationship-history-empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FoundationIcon name="organization" decorative />
                </EmptyMedia>
                <EmptyTitle>Todavía no hay nada que contar</EmptyTitle>
                <EmptyDescription>
                  Aquí irán apareciendo las altas, los cambios de profesional, las suplencias y lo
                  que la persona decida sobre sus permisos.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol data-relationship-history-list aria-label="Historia del vínculo">
              {events.map((event) => (
                <li key={`${event.occurred_at}-${event.type}-${event.source_id}`}>
                  <HistoryEntry event={event} personName={personName} />
                </li>
              ))}
            </ol>
          )}

          {historyQuery.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              data-relationship-history-more
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}
            >
              {historyQuery.isFetchingNextPage ? <Spinner label="Cargando más" /> : null}
              {historyQuery.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function HistoryEntry({
  event,
  personName,
}: {
  event: RelationshipHistoryEvent
  personName: string
}) {
  const occurred = new Date(event.occurred_at)
  const reason = endedReason(event)
  const elsewhere = endedElsewhereNote(event)

  return (
    <article data-relationship-history-entry data-kind={event.type}>
      {/*
       * A machine-readable instant beside the words. A record people may have to
       * rely on later should not force a reader to trust a formatted string.
       */}
      <time dateTime={event.occurred_at} data-relationship-history-when>
        <span data-history-date>{DATE_FORMATTER.format(occurred)}</span>
        <span data-history-time>{TIME_FORMATTER.format(occurred)}</span>
      </time>
      <div data-relationship-history-what>
        <p data-history-title>{historyEventTitle(event, personName)}</p>
        {reason ? <p data-history-reason>«{reason}»</p> : null}
        {elsewhere ? <p data-history-note>{elsewhere}</p> : null}
      </div>
    </article>
  )
}

function LoadingState() {
  return (
    <div data-relationship-history data-loading>
      <WorkspacePageHeader description="Cargando la historia del vínculo…" />
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Historia del vínculo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" aria-live="polite" data-relationship-history-loading>
            Cargando la historia…
          </p>
          <Skeleton data-history-skeleton />
          <Skeleton data-history-skeleton />
          <Skeleton data-history-skeleton />
        </CardContent>
      </Card>
    </div>
  )
}

/*
 * Not found and not permitted are one answer, as everywhere else in this block:
 * telling a coach that a relationship exists but is not theirs already says the
 * gym has that client.
 */
function UnreachableState({ directoryPath }: { directoryPath: string }) {
  return (
    <div data-relationship-history data-unreachable>
      <WorkspacePageHeader description="No encontramos este vínculo." />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FoundationIcon name="organization" decorative />
          </EmptyMedia>
          <EmptyTitle>Este vínculo no está disponible</EmptyTitle>
          <EmptyDescription>
            Puede que ya no exista, o que no sea uno de los que atiendes.
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

function DeniedState() {
  return (
    <div data-relationship-history data-denied>
      <WorkspacePageHeader description="No puedes ver la historia de este vínculo." />
      <Alert variant="warning" data-relationship-history-denied>
        <AlertTitle>Tu rol no incluye leer el directorio</AlertTitle>
        <AlertDescription>
          Para consultar la historia de un cliente hace falta ver el directorio de personas.
          Pídeselo a quien administre el gimnasio.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function FailureState({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-relationship-history data-failed>
      <WorkspacePageHeader description="No pudimos cargar la historia del vínculo." />
      <Alert variant="danger" live="assertive" data-relationship-history-failed>
        <AlertTitle>No pudimos cargar la historia</AlertTitle>
        <AlertDescription>
          La conexión falló de forma temporal. No se perdió nada: este registro no se edita ni se
          borra, así que vuelve a intentarlo.
        </AlertDescription>
        <Button type="button" variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </Alert>
    </div>
  )
}
