'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { ActivationForm } from './activation-form'
import { LogoutForm } from './logout-form'
import { LoadingStage, StudioFrame } from './studio-frame'
import { clearPendingInvitationToken, readPendingInvitationToken } from '@/lib/invitation-token'
import { createCommandIntentManager } from '@/lib/command-intent'
import { prepareStudioAuthentication } from '@/lib/session-activity'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type OnboardingAttempt,
  type StudioEntryContext,
  type TeamInvitationPresentation,
} from '@/lib/studio-api'
import { invitationRoleLabel } from '@/lib/team-invitations'

type Flow =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; token: string; invitation: TeamInvitationPresentation; authenticated: boolean }
  | {
      kind: 'activation'
      token: string
      invitation: TeamInvitationPresentation
      attempt: OnboardingAttempt
      identity: StudioEntryContext['identity']
    }
  | { kind: 'mismatch'; invitation: TeamInvitationPresentation }
  | { kind: 'rejected'; organizationName: string }
  | { kind: 'error'; message: string }

export function TeamInvitationDecision() {
  const router = useRouter()
  const [flow, setFlow] = useState<Flow>({ kind: 'loading' })
  const [deciding, setDeciding] = useState<'accepted' | 'rejected'>()
  const [decisionCommandIntent] = useState(() => createCommandIntentManager(newCommand))
  const bootstrapStarted = useRef(false)

  const bootstrap = useCallback(async () => {
    const token = readPendingInvitationToken()
    if (!token) {
      setFlow({ kind: 'invalid' })
      return
    }
    setFlow({ kind: 'loading' })
    try {
      const [invitation, sessionResult] = await Promise.all([
        studioApi.resolveTeamInvitation(token),
        studioApi.session().then(
          (session) => ({ authenticated: true as const, session }),
          (error: unknown) => {
            if (error instanceof StudioApiError && error.status === 401) {
              return { authenticated: false as const }
            }
            throw error
          },
        ),
      ])
      if (!sessionResult.authenticated) {
        setFlow({ kind: 'ready', token, invitation, authenticated: false })
        return
      }
      if (sessionResult.session.registration_status === 'registration_incomplete') {
        const attempt = await studioApi.startAttempt(newCommand(), token)
        const { given_name: givenName, family_name: familyName } = sessionResult.session.identity
        setFlow({
          kind: 'activation',
          token,
          invitation,
          attempt,
          identity: {
            name: givenName && familyName ? `${givenName} ${familyName}` : null,
            email: null,
          },
        })
        return
      }
      setFlow({ kind: 'ready', token, invitation, authenticated: true })
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 404) {
        clearPendingInvitationToken()
        setFlow({ kind: 'invalid' })
        return
      }
      setFlow({
        kind: 'error',
        message:
          error instanceof StudioApiError && error.status === 429
            ? 'Se hicieron demasiados intentos. Espera un momento antes de volver a abrir la invitación.'
            : 'No pudimos consultar la invitación en este momento.',
      })
    }
  }, [])

  useEffect(() => {
    if (bootstrapStarted.current) return
    bootstrapStarted.current = true
    void bootstrap()
  }, [bootstrap])

  async function decide(decision: 'accepted' | 'rejected') {
    if (flow.kind !== 'ready' || !flow.authenticated || deciding) return
    setDeciding(decision)
    try {
      const intent = flow.invitation.intents[0]
      if (!intent) throw new Error('Invitation has no membership intent')
      const body = {
        token: flow.token,
        decisions: [{ intent_id: intent.id, decision }],
      }
      const command = decisionCommandIntent.commandFor({
        operation: 'invitation:decide',
        resourceId: intent.id,
        payload: body,
      })
      const result = await studioApi.decideTeamInvitation(body, command)
      decisionCommandIntent.reset()
      clearPendingInvitationToken()
      if (result.intent.status === 'accepted') {
        router.replace(`/organizations/${result.organization_id}`)
        return
      }
      setFlow({ kind: 'rejected', organizationName: flow.invitation.organization.display_name })
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 403) {
        decisionCommandIntent.reset()
        setFlow({ kind: 'mismatch', invitation: flow.invitation })
      } else if (error instanceof StudioApiError && error.status === 404) {
        decisionCommandIntent.reset()
        clearPendingInvitationToken()
        setFlow({ kind: 'invalid' })
      } else {
        setFlow({ kind: 'error', message: 'No pudimos guardar tu decisión. Inténtalo de nuevo.' })
      }
    } finally {
      setDeciding(undefined)
    }
  }

  if (flow.kind === 'loading') return <LoadingStage label="Consultando la invitación…" />
  if (flow.kind === 'activation') {
    return (
      <ActivationForm
        attempt={flow.attempt}
        identity={flow.identity}
        onComplete={() =>
          setFlow({
            kind: 'ready',
            token: flow.token,
            invitation: flow.invitation,
            authenticated: true,
          })
        }
        onSessionExpired={() =>
          setFlow({
            kind: 'ready',
            token: flow.token,
            invitation: flow.invitation,
            authenticated: false,
          })
        }
        onRetryAttempt={async () => {
          const attempt = await studioApi.startAttempt(newCommand(), flow.token)
          setFlow({ ...flow, attempt })
        }}
      />
    )
  }
  if (flow.kind === 'invalid') {
    return (
      <InvitationMessage
        title="Esta invitación ya no está disponible"
        description="Puede haber vencido, sido revocada o ya haberse decidido."
      />
    )
  }
  if (flow.kind === 'error') {
    return (
      <InvitationMessage title="No pudimos abrir la invitación" description={flow.message}>
        <Button onClick={() => void bootstrap()}>Reintentar</Button>
      </InvitationMessage>
    )
  }
  if (flow.kind === 'mismatch') {
    return (
      <InvitationMessage
        title="Esta invitación fue enviada a otra cuenta"
        description="Cierra sesión y entra con el correo que recibió la invitación."
      >
        <LogoutForm variant="outline" size="default" />
      </InvitationMessage>
    )
  }
  if (flow.kind === 'rejected') {
    return (
      <InvitationMessage
        title="Rechazaste la invitación"
        description={`No se creó ninguna membresía en ${flow.organizationName}.`}
      >
        <Button onClick={() => router.replace('/')}>Volver a Studio</Button>
      </InvitationMessage>
    )
  }

  const intent = flow.invitation.intents[0]
  return (
    <StudioFrame step="identity" showLogout={flow.authenticated}>
      <article data-studio-panel="invitation-decision">
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Invitación de equipo</p>
          <h1>{flow.invitation.organization.display_name} quiere sumarte a su equipo.</h1>
          <p>
            Revisa la propuesta antes de decidir. Aceptarla crea solo una membresía de equipo en
            Studio.
          </p>
        </div>
        <dl data-team-invitation-summary>
          <div>
            <dt>Organización</dt>
            <dd>{flow.invitation.organization.display_name}</dd>
          </div>
          <div>
            <dt>Responsable</dt>
            <dd>{flow.invitation.organization.responsible_party.name}</dd>
          </div>
          <div>
            <dt>Rol propuesto</dt>
            <dd>{intent ? invitationRoleLabel(intent.proposed_role_code) : 'Equipo'}</dd>
          </div>
          <div>
            <dt>Vigencia</dt>
            <dd>{formatDate(flow.invitation.expires_at)}</dd>
          </div>
        </dl>
        {flow.authenticated ? (
          <div data-team-invitation-actions>
            <Button onClick={() => void decide('accepted')} disabled={Boolean(deciding)}>
              {deciding === 'accepted' ? 'Aceptando…' : 'Aceptar invitación'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void decide('rejected')}
              disabled={Boolean(deciding)}
            >
              {deciding === 'rejected' ? 'Rechazando…' : 'Rechazar'}
            </Button>
          </div>
        ) : (
          <div data-team-invitation-actions>
            <a
              className={buttonVariants({ size: 'lg' })}
              href={`${studioApi.apiUrl}/studio/v1/auth/start`}
              onClick={prepareStudioAuthentication}
            >
              Entrar para decidir
            </a>
            <Badge variant="warning">Debes usar el correo invitado</Badge>
          </div>
        )}
      </article>
    </StudioFrame>
  )
}

function InvitationMessage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <StudioFrame step="identity" showLogout={false}>
      <div data-studio-error-stage>
        <Alert variant="warning" live="polite">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
          {children}
        </Alert>
      </div>
    </StudioFrame>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(value),
  )
}
