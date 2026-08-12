'use client'

import { ProductLockup } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import {
  AccessDescription,
  AccessEyebrow,
  AccessHeader,
  AccessHero,
  AccessJourney,
  AccessJourneyIndex,
  AccessJourneyLabel,
  AccessJourneyStep,
  AccessMain,
  AccessPanel,
  AccessPanelAction,
  AccessPanelContent,
  AccessPanelDescription,
  AccessPanelEyebrow,
  AccessPanelHeader,
  AccessPanelNote,
  AccessPanelTitle,
  AccessShell,
  AccessTitle,
} from '@allfitone/react/components/access-shell'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { PulseMark } from '@allfitone/react/components/pulse-mark'
import { ForwardIcon, FoundationIcon } from '@allfitone/react/icons'
import { useEffect, useRef } from 'react'

import { prepareStudioAuthentication, type StudioSessionEndReason } from '@/lib/session-activity'
import { studioApi } from '@/lib/studio-api'

interface SessionRecovery {
  reason: StudioSessionEndReason
  retryable: boolean
  onRetry: () => void
}

interface SessionClosing {
  reason: StudioSessionEndReason
}

export function AccessLanding({
  logoutPartial = false,
  closing,
  recovery,
}: {
  logoutPartial?: boolean
  closing?: SessionClosing
  recovery?: SessionRecovery
}) {
  useEffect(() => {
    if (!logoutPartial) return
    const url = new URL(window.location.href)
    url.searchParams.delete('logout')
    window.history.replaceState(window.history.state, '', url)
  }, [logoutPartial])

  const secureState = closing ?? recovery
  const secureStateActive = Boolean(secureState)
  const secureTitleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (secureStateActive) secureTitleRef.current?.focus()
  }, [secureStateActive])

  const secureTitle = closing
    ? 'Cerrando tu sesión'
    : recovery
      ? 'Tu sesión está protegida'
      : 'Entra. El contexto ya está listo.'

  return (
    <AccessShell>
      <AccessHeader>
        <ProductLockup
          product="studio"
          surface="light"
          title="Allfit Studio"
          width={169}
          height={40}
        />
      </AccessHeader>

      <AccessMain>
        <AccessHero aria-labelledby="studio-access-title">
          <AccessEyebrow>
            <PulseMark />
            Studio para espacios y profesionales
          </AccessEyebrow>
          <AccessTitle id="studio-access-title">Haz que cada entrenamiento cuente.</AccessTitle>
          <AccessDescription>
            Planifica con contexto, acompaña con claridad y ajusta sin perder la continuidad de cada
            persona.
          </AccessDescription>
        </AccessHero>

        <AccessPanel aria-labelledby="studio-panel-title">
          <AccessPanelHeader>
            <AccessPanelEyebrow>
              {closing ? 'Cierre seguro' : recovery ? 'Sesión protegida' : 'Tu espacio de trabajo'}
            </AccessPanelEyebrow>
            <AccessPanelTitle
              ref={secureTitleRef}
              id="studio-panel-title"
              tabIndex={secureState ? -1 : undefined}
            >
              {secureTitle}
            </AccessPanelTitle>
            <AccessPanelDescription>
              {closing
                ? 'Studio ya ocultó tu espacio. Estamos terminando el cierre con el proveedor de acceso.'
                : recovery
                  ? 'Completa el cierre antes de volver a autenticarte en este equipo.'
                  : 'Accede de forma segura para continuar con tus espacios, equipo y actividad.'}
            </AccessPanelDescription>
          </AccessPanelHeader>

          <AccessPanelContent>
            {closing ? (
              <Alert variant="info" live="polite">
                <AlertTitle>El espacio de trabajo ya está protegido</AlertTitle>
                <AlertDescription>{closingDescription(closing.reason)}</AlertDescription>
              </Alert>
            ) : null}
            {recovery ? (
              <Alert variant="warning" live="assertive">
                <AlertTitle>El espacio de trabajo permanece oculto</AlertTitle>
                <AlertDescription>{recoveryDescription(recovery.reason)}</AlertDescription>
              </Alert>
            ) : null}
            {logoutPartial ? (
              <Alert variant="warning" live="polite">
                <AlertTitle>La sesión se cerró en este equipo</AlertTitle>
                <AlertDescription>
                  No pudimos confirmar todo el cierre remoto. Si vuelves a entrar, completa de nuevo
                  el acceso con el proveedor de identidad.
                </AlertDescription>
              </Alert>
            ) : null}
            {closing ? (
              <ClosingSignal />
            ) : (
              <AccessPanelAction>
                {recovery ? (
                  <>
                    <form action={`${studioApi.apiUrl}/studio/v1/auth/logout`} method="post">
                      <input type="hidden" name="reason" value="recovery" />
                      <Button type="submit" size="lg">
                        Completar cierre
                      </Button>
                    </form>
                    {recovery.retryable ? (
                      <Button type="button" size="lg" variant="outline" onClick={recovery.onRetry}>
                        Reintentar
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <a
                    data-slot="button"
                    data-variant="default"
                    className={buttonVariants({ size: 'lg' })}
                    href={`${studioApi.apiUrl}/studio/v1/auth/start`}
                    onClick={prepareStudioAuthentication}
                  >
                    Entrar a Studio
                    <ForwardIcon data-icon="inline-end" decorative />
                  </a>
                )}
              </AccessPanelAction>
            )}
          </AccessPanelContent>

          <AccessPanelNote>
            <FoundationIcon name="permissions" decorative />
            {closing
              ? 'Volverás a la pantalla de acceso cuando el cierre termine.'
              : recovery
                ? 'No mostraremos información anterior hasta que vuelvas a autenticarte.'
                : 'El inicio de sesión se completa con el proveedor de identidad de Allfit One.'}
          </AccessPanelNote>
        </AccessPanel>

        <AccessJourney aria-label="Flujo de trabajo en Studio">
          <AccessJourneyStep>
            <AccessJourneyIndex>01</AccessJourneyIndex>
            <AccessJourneyLabel>Planifica</AccessJourneyLabel>
          </AccessJourneyStep>
          <AccessJourneyStep>
            <AccessJourneyIndex>02</AccessJourneyIndex>
            <AccessJourneyLabel>Acompaña</AccessJourneyLabel>
          </AccessJourneyStep>
          <AccessJourneyStep>
            <AccessJourneyIndex>03</AccessJourneyIndex>
            <AccessJourneyLabel>Ajusta</AccessJourneyLabel>
          </AccessJourneyStep>
        </AccessJourney>
      </AccessMain>
    </AccessShell>
  )
}

function ClosingSignal() {
  return (
    <div data-session-closing-signal role="status" aria-live="polite" aria-atomic="true">
      <div data-closing-step="complete">
        <span aria-hidden="true" />
        <strong>Espacio oculto</strong>
      </div>
      <i aria-hidden="true" />
      <div data-closing-step="current">
        <span aria-hidden="true" />
        <strong>Confirmando cierre</strong>
      </div>
    </div>
  )
}

function closingDescription(reason: StudioSessionEndReason): string {
  if (reason === 'inactivity') {
    return 'El tiempo de inactividad terminó. Estamos cerrando el acceso de forma segura.'
  }
  if (reason === 'manual') {
    return 'Solicitaste cerrar la sesión. No necesitas hacer nada más.'
  }
  return 'Studio está terminando el cierre seguro en este equipo.'
}

function recoveryDescription(reason: StudioSessionEndReason): string {
  if (reason === 'inactivity') {
    return 'Tu sesión terminó por inactividad. Studio desmontó el contenido para proteger la información.'
  }
  if (reason === 'manual') {
    return 'Solicitaste cerrar la sesión. Studio desmontó el contenido mientras completa el cierre seguro.'
  }
  return 'Esta sesión se marcó como terminada. Studio desmontó el contenido para proteger la información.'
}
