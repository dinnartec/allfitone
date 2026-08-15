'use client'

import { Button } from '@allfitone/react/components/button'
import type { TelemetryScreen } from '@allfitone/telemetry'
import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'
import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  captureStudioTelemetry,
  initializeStudioTelemetry,
  setStudioAnalyticsConsent,
  studioTelemetryCommon,
  studioTelemetryServerSnapshot,
  studioTelemetrySnapshot,
  subscribeStudioTelemetry,
} from '@/lib/telemetry'

export function AnalyticsControls() {
  const telemetry = useSyncExternalStore(
    subscribeStudioTelemetry,
    studioTelemetrySnapshot,
    studioTelemetryServerSnapshot,
  )
  const [expanded, setExpanded] = useState(false)
  const pathname = usePathname()

  useEffect(() => initializeStudioTelemetry(), [])
  useEffect(() => {
    if (!telemetry.active) return
    captureStudioTelemetry({
      event: 'client.screen.viewed.v1',
      properties: { ...studioTelemetryCommon(), screen: studioScreen(pathname) },
    })
  }, [pathname, telemetry.active])

  useReportWebVitals((metric) => {
    if (!['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].includes(metric.name)) return
    captureStudioTelemetry({
      event: 'client.performance.measured.v1',
      properties: {
        ...studioTelemetryCommon(),
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
            contenido, nombres, correos ni datos de salud.
          </p>
          {telemetry.privacySignalDenied ? (
            <p>La señal de privacidad de este dispositivo mantiene la analítica desactivada.</p>
          ) : (
            <div data-analytics-actions>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setStudioAnalyticsConsent('granted')
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
                  setStudioAnalyticsConsent('denied')
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

function studioScreen(pathname: string): TelemetryScreen {
  if (pathname === '/account') return 'studio.account'
  if (pathname === '/profile') return 'studio.profile'
  if (pathname.includes('/team/invitations/new')) return 'studio.team_invitation_new'
  if (pathname.includes('/team/invitations')) return 'studio.team_invitations'
  if (pathname.includes('/team/roles')) return 'studio.team_roles'
  if (pathname.includes('/team')) return 'studio.team_directory'
  if (pathname.startsWith('/invitations')) return 'studio.invitation_decision'
  if (pathname.startsWith('/organizations/')) return 'studio.organization_overview'
  return 'studio.entry'
}
