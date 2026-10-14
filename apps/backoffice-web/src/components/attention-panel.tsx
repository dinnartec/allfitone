'use client'

/**
 * `HU-BO-005` — what needs attention, as the first screen behind the login.
 *
 * Counters, never files. Each notice leads to the screen where it is resolved,
 * and that screen checks its own duty again: the panel is a signpost, not a door.
 *
 * A notice the operator's duties do not resolve arrives `withheld` and is drawn
 * as withheld — never as a zero, which would tell the operator to relax about
 * something nobody counted for them. Payments are not modelled yet and say so.
 *
 * Repeated failures are a list rather than a table: inside a notice card a table
 * scrolled its count and last error out of view, and those are what an operator
 * reads first.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Spinner } from '@allfitone/react/components/spinner'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type SupportAttentionPanel,
} from '@/lib/backoffice-api'
import {
  ATTENTION_DESTINATIONS,
  GYM_CHARGES_NOTE,
  attentionMessage,
  billingSummary,
  failureSummary,
  groupLine,
  needsAction,
  unclaimedSummary,
  verificationSummary,
} from '@/lib/attention-panel'
import { sourceLabel } from '@/lib/support-diagnosis'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'failed'

export function AttentionPanel() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [panel, setPanel] = useState<SupportAttentionPanel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setPanel(await backofficeApi.supportAttention(controller.signal))
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(failureMessage(error))
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [])

  if (state === 'loading') return <Spinner />

  if (state === 'failed' || !panel) {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo leer lo que necesita atención</AlertTitle>
        <AlertDescription>{failure ?? attentionMessage('upstream-unavailable')}</AlertDescription>
      </Alert>
    )
  }

  const action = needsAction(panel)
  const verifications = panel.credential_verifications
  const unclaimed = panel.unclaimed_organizations
  const failures = panel.repeated_failures

  return (
    <div data-attention-panel>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Qué necesita atención
          </CardTitle>
          <CardDescription>
            Contadores, nunca expedientes. Cada aviso lleva a la pantalla donde se resuelve, y esa
            pantalla vuelve a comprobar tu deber. Leído: {formatInstant(panel.generated_at)}
          </CardDescription>
        </CardHeader>
      </Card>

      <div data-attention-notices>
        <Notice
          kind="billing"
          availability={panel.billing.availability}
          title="Cobros fallidos y suscripciones suspendidas"
          summary={billingSummary(panel.billing)}
          urgent={action.billing}
        >
          {panel.billing.availability === 'available' ? (
            <p data-attention-detail>{GYM_CHARGES_NOTE}</p>
          ) : null}
        </Notice>

        <Notice
          kind="verifications"
          availability={verifications.availability}
          title="Verificaciones de título pendientes"
          summary={verificationSummary(verifications)}
          urgent={action.verifications}
          destination={
            verifications.availability === 'available'
              ? { href: ATTENTION_DESTINATIONS.verifications, label: 'Ir a verificar títulos' }
              : undefined
          }
        >
          {verifications.oldest_requested_at ? (
            <p data-attention-detail>
              La más antigua espera desde: {formatInstant(verifications.oldest_requested_at)}
            </p>
          ) : null}
        </Notice>

        <Notice
          kind="unclaimed"
          availability={unclaimed.availability}
          title="Gimnasios que nadie ha reclamado"
          summary={unclaimedSummary(unclaimed)}
          urgent={action.unclaimedOrganizations}
          destination={
            unclaimed.availability === 'available'
              ? {
                  href: ATTENTION_DESTINATIONS.unclaimedOrganizations,
                  label: 'Ver los gimnasios sin reclamar',
                }
              : undefined
          }
        >
          {unclaimed.oldest_created_at ? (
            <p data-attention-detail>
              El más antiguo se creó: {formatInstant(unclaimed.oldest_created_at)}
            </p>
          ) : null}
        </Notice>

        <Notice
          kind="failures"
          availability={failures.availability}
          title="Errores del sistema que se repiten"
          summary={failureSummary(failures)}
          urgent={action.failures}
          destination={
            failures.availability === 'available'
              ? { href: ATTENTION_DESTINATIONS.failures, label: 'Ir al diagnóstico técnico' }
              : undefined
          }
        >
          {failures.open_circuits && failures.open_circuits.length > 0 ? (
            <ul data-attention-list data-attention-circuits>
              {failures.open_circuits.map((circuit) => (
                <li key={circuit.event_type}>
                  <code>{circuit.event_type}</code>
                  <span>
                    Canal {circuit.state === 'open' ? 'interrumpido' : 'probando de nuevo'} ·{' '}
                    {circuit.failure_count} fallas
                  </span>
                  {circuit.opened_until ? (
                    <span>Reabre: {formatInstant(circuit.opened_until)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {failures.groups && failures.groups.length > 0 ? (
            <ul data-attention-list aria-label="Errores que se repiten">
              {failures.groups.map((group) => (
                <li key={`${group.source}-${group.label}`} data-attention-failure>
                  <code>{group.label}</code>
                  <span>
                    {sourceLabel(group.source)} · {groupLine(group)}
                  </span>
                  <span>
                    Último error:{' '}
                    {group.last_error_code ? <code>{group.last_error_code}</code> : '—'} ·{' '}
                    {formatInstant(group.latest_occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Notice>
      </div>
    </div>
  )
}

const AVAILABILITY_BADGES: Record<
  'available' | 'withheld' | 'not_modelled',
  { label: string; variant: 'secondary' | 'warning' | 'success' }
> = {
  available: { label: 'Al día', variant: 'success' },
  withheld: { label: 'No es de tus deberes', variant: 'secondary' },
  not_modelled: { label: 'Sin datos aún', variant: 'secondary' },
}

function Notice({
  kind,
  availability,
  title,
  summary,
  urgent = false,
  destination,
  children,
}: {
  kind: string
  availability: 'available' | 'withheld' | 'not_modelled'
  title: string
  summary: string
  urgent?: boolean
  destination?: { href: string; label: string } | undefined
  children?: ReactNode
}) {
  const badge = urgent
    ? { label: 'Pendiente', variant: 'warning' as const }
    : AVAILABILITY_BADGES[availability]

  return (
    <Card data-attention-notice={kind} data-availability={availability}>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          {title}
        </CardTitle>
        <CardDescription>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div data-attention-body>
          <p data-attention-summary>{summary}</p>
          {children}
          {destination ? (
            <Link href={destination.href} data-attention-link>
              {destination.label}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return attentionMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return attentionMessage(error.code)
  return attentionMessage('upstream-unavailable')
}
