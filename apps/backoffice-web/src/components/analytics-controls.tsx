'use client'

import { Button } from '@allfitone/react/components/button'
import { useReportWebVitals } from 'next/web-vitals'
import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  backofficeTelemetryCommon,
  backofficeTelemetryServerSnapshot,
  backofficeTelemetrySnapshot,
  captureBackofficeTelemetry,
  initializeBackofficeTelemetry,
  setBackofficeAnalyticsConsent,
  subscribeBackofficeTelemetry,
} from '@/lib/telemetry'

export function AnalyticsControls() {
  const telemetry = useSyncExternalStore(
    subscribeBackofficeTelemetry,
    backofficeTelemetrySnapshot,
    backofficeTelemetryServerSnapshot,
  )
  const [expanded, setExpanded] = useState(false)

  useEffect(() => initializeBackofficeTelemetry(), [])
  useEffect(() => {
    if (!telemetry.active) return
    captureBackofficeTelemetry({
      event: 'client.screen.viewed.v1',
      properties: { ...backofficeTelemetryCommon(), screen: 'backoffice.access' },
    })
  }, [telemetry.active])

  useReportWebVitals((metric) => {
    if (!['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].includes(metric.name)) return
    captureBackofficeTelemetry({
      event: 'client.performance.measured.v1',
      properties: {
        ...backofficeTelemetryCommon(),
        metric: metric.name as 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB',
        value: metric.value,
        rating: metric.rating,
      },
    })
  })

  const open = telemetry.decision === 'undecided' || expanded
  return (
    <aside
      data-analytics-controls
      data-expanded={open ? 'true' : 'false'}
      aria-label="Preferencias de analítica"
    >
      {open ? (
        <div data-analytics-panel>
          <strong>Analítica opcional</strong>
          <p>
            Ayúdanos a medir rendimiento y uso con un identificador seudónimo. No capturamos
            contenido, credenciales, nombres ni correos.
          </p>
          {telemetry.privacySignalDenied ? (
            <p>La señal de privacidad de este dispositivo mantiene la analítica desactivada.</p>
          ) : (
            <div data-analytics-actions>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setBackofficeAnalyticsConsent('granted')
                  setExpanded(false)
                }}
              >
                Permitir analítica
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setBackofficeAnalyticsConsent('denied')
                  setExpanded(false)
                }}
              >
                No permitir
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
          Privacidad
        </Button>
      )}
    </aside>
  )
}
