'use client'

/**
 * `HU-BO-004` — how the business is going.
 *
 * One number per card, with the period under it, because a figure whose period
 * the reader has to assume is worse than no figure. A figure the platform cannot
 * give is drawn blank with the reason in its place: never a zero, which would be
 * read as "the business is at zero" rather than "we cannot answer".
 *
 * The two activity figures sit next to each other on purpose. People training in
 * Space is the question the founder is actually asking and has no answer at all;
 * professionals working in Studio is what the platform does record. Showing the
 * second alone, unlabelled, would quietly answer the first with the wrong number.
 *
 * Being refused is not an error: the duty expires by design, so it is said in
 * plain words and the rest of the screen carries on without it.
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
import { useEffect, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type SupportBusinessPanel,
} from '@/lib/backoffice-api'
import {
  businessMessage,
  businessSections,
  metricBadge,
  metricHint,
  metricLabel,
  metricNote,
  metricValue,
  periodPhrase,
} from '@/lib/business-panel'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'refused' | 'failed'

export function BusinessPanel() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [panel, setPanel] = useState<SupportBusinessPanel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setPanel(await backofficeApi.supportBusiness(controller.signal))
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(failureMessage(error))
        setState(
          error instanceof BackofficeApiError && error.code === 'forbidden' ? 'refused' : 'failed',
        )
      }
    })()
    return () => controller.abort()
  }, [])

  if (state === 'loading') return <Spinner />

  if (state === 'refused') {
    return (
      <Alert live="polite" variant="info" data-business-refused>
        <AlertTitle>Cómo va el negocio</AlertTitle>
        <AlertDescription>{failure ?? businessMessage('forbidden')}</AlertDescription>
      </Alert>
    )
  }

  if (state === 'failed' || !panel) {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo leer cómo va el negocio</AlertTitle>
        <AlertDescription>{failure ?? businessMessage('upstream-unavailable')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-business-panel>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Cómo va el negocio
          </CardTitle>
          <CardDescription>
            Cada cifra dice de qué periodo es. Lo que la plataforma todavía no puede calcular
            aparece vacío con su razón, nunca en cero, y un grupo de menos de{' '}
            {panel.minimum_aggregate} personas no se publica. Leído:{' '}
            {formatInstant(panel.generated_at)}
          </CardDescription>
        </CardHeader>
      </Card>

      {businessSections(panel).map((section) => (
        <section key={section.key} data-business-section={section.key}>
          <h3 data-business-section-title>{section.title}</h3>
          <p data-business-section-description>{section.description}</p>
          <div data-business-metrics>
            {section.metrics.map((metric) => {
              const badge = metricBadge(metric)
              const note = metricNote(metric, panel.minimum_aggregate)
              const hint = metricHint(metric.key)
              return (
                <Card
                  key={metric.key}
                  data-business-metric={metric.key}
                  data-availability={metric.availability}
                >
                  <CardHeader>
                    <CardTitle role="heading" aria-level={4}>
                      {metricLabel(metric.key)}
                    </CardTitle>
                    <CardDescription>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div data-business-body>
                      <p data-business-value>{metricValue(metric)}</p>
                      <p data-business-period>{periodPhrase(metric.period)}</p>
                      {note ? <p data-business-note>{note}</p> : null}
                      {hint ? <p data-business-hint>{hint}</p> : null}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return businessMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return businessMessage(error.code)
  return businessMessage('upstream-unavailable')
}
