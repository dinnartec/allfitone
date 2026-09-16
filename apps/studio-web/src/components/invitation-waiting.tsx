'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import {
  SetupPanel,
  SetupPanelActions,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelNote,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import { FoundationIcon } from '@allfitone/react/icons'
import { useState } from 'react'

import { StudioFrame } from './studio-frame'
import { StudioApiError } from '@/lib/studio-api'

export function InvitationWaiting({
  onCheck,
  onBack,
}: {
  onCheck: () => Promise<void>
  onBack: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()

  async function checkAgain() {
    if (checking) return
    setChecking(true)
    setError(undefined)
    try {
      await onCheck()
    } catch (caught) {
      setError(
        caught instanceof StudioApiError && caught.status === 503
          ? 'No pudimos comprobar tus invitaciones. La conexión falló de forma temporal.'
          : 'No pudimos comprobar tus invitaciones. Inténtalo de nuevo.',
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <StudioFrame step="space">
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Esperando una invitación</SetupPanelEyebrow>
          <SetupPanelTitle>Tu espacio puede llegar después.</SetupPanelTitle>
          <SetupPanelDescription>
            No crearemos una organización ni una membresía mientras esperas. Cuando un equipo te
            incorpore, Studio te llevará a ese espacio.
          </SetupPanelDescription>
          <SetupPanelNote>
            <FoundationIcon name="activity" decorative />
            Las membresías se consultan de nuevo solo cuando tú lo pides o cuando vuelves a entrar.
          </SetupPanelNote>
        </SetupPanelIntro>

        <SetupPanelContent data-invitation-waiting>
          <Empty role="status">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoundationIcon name="organization" decorative />
              </EmptyMedia>
              <EmptyTitle>Sin membresías activas</EmptyTitle>
              <EmptyDescription data-flush-text>
                Puedes cerrar esta sesión con tranquilidad y volver desde el enlace de acceso.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          {error ? (
            <Alert variant="warning" live="polite">
              <AlertTitle>La comprobación no terminó</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <SetupPanelActions>
            <Button size="lg" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? 'Comprobando…' : 'Comprobar de nuevo'}
            </Button>
            <Button size="lg" variant="outline" onClick={onBack} disabled={checking}>
              Volver
            </Button>
          </SetupPanelActions>
        </SetupPanelContent>
      </SetupPanel>
    </StudioFrame>
  )
}
