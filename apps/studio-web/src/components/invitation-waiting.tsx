'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { useState } from 'react'

import { StudioFrame } from './studio-frame'
import { StudioApiError, studioApi } from '@/lib/studio-api'

export function InvitationWaiting({ onCheck }: { onCheck: () => Promise<void> }) {
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
    <StudioFrame step="space" showLogout={false}>
      <article data-studio-panel="waiting">
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Esperando una invitación</p>
          <h1>Tu espacio puede llegar después.</h1>
          <p>
            No crearemos una organización ni una membresía mientras esperas. Cuando un equipo te
            incorpore, Studio te llevará a ese espacio.
          </p>
          <div data-studio-signal-note>
            <span aria-hidden="true">↻</span>
            <p>
              Las membresías se consultan de nuevo solo cuando tú lo pides o cuando vuelves a
              entrar.
            </p>
          </div>
        </div>

        <div data-invitation-waiting>
          <div data-invitation-status role="status">
            <span>Estado actual</span>
            <strong>Sin membresías activas</strong>
            <p>Puedes cerrar esta sesión con tranquilidad y volver desde el enlace de acceso.</p>
          </div>

          {error ? (
            <Alert variant="warning" live="polite">
              <AlertTitle>La comprobación no terminó</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div data-invitation-actions>
            <Button size="lg" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? 'Comprobando…' : 'Comprobar de nuevo'}
            </Button>
            <form action={`${studioApi.apiUrl}/studio/v1/auth/logout`} method="post">
              <Button type="submit" size="lg" variant="outline" disabled={checking}>
                Cerrar sesión
              </Button>
            </form>
          </div>
        </div>
      </article>
    </StudioFrame>
  )
}
