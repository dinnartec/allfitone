'use client'

/**
 * The invitation page: a team invitation, or an organization Allfit hands over.
 *
 * Both arrive at `/invitations` with a token in the fragment, and both survive a first
 * sign-up the same way. The page asks for a team invitation first and, only when the
 * token is not one, for an ownership invitation. The two are resolved and decided on
 * separate routes, so neither can be accepted as the other.
 *
 * An ownership invitation says before anything else that the organization does not
 * operate until it is accepted: the person is being offered ownership, not told they
 * already have it.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Card, CardContent } from '@allfitone/react/components/card'
import {
  SetupPanel,
  SetupPanelActions,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
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
  type OwnershipInvitationPresentation,
  type StudioEntryContext,
  type TeamInvitationPresentation,
} from '@/lib/studio-api'
import { invitationRoleLabel } from '@/lib/team-invitations'

type Resolved =
  | { kind: 'team'; invitation: TeamInvitationPresentation }
  | { kind: 'ownership'; invitation: OwnershipInvitationPresentation }

type Flow =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; token: string; resolved: Resolved; authenticated: boolean }
  | {
      kind: 'activation'
      token: string
      resolved: Resolved
      attempt: OnboardingAttempt
      identity: StudioEntryContext['identity']
    }
  | { kind: 'mismatch' }
  | { kind: 'rejected'; description: string }
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
      const [resolved, sessionResult] = await Promise.all([
        resolveInvitation(token),
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
        setFlow({ kind: 'ready', token, resolved, authenticated: false })
        return
      }
      if (sessionResult.session.registration_status === 'registration_incomplete') {
        const attempt = await studioApi.startAttempt(newCommand(), token)
        const { given_name: givenName, family_name: familyName } = sessionResult.session.identity
        setFlow({
          kind: 'activation',
          token,
          resolved,
          attempt,
          identity: {
            name: givenName && familyName ? `${givenName} ${familyName}` : null,
            email: null,
          },
        })
        return
      }
      setFlow({ kind: 'ready', token, resolved, authenticated: true })
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
    const resolved = flow.resolved
    try {
      let organizationId: string
      let accepted: boolean
      if (resolved.kind === 'team') {
        const intent = resolved.invitation.intents[0]
        if (!intent) throw new Error('Invitation has no membership intent')
        const body = { token: flow.token, decisions: [{ intent_id: intent.id, decision }] }
        const command = decisionCommandIntent.commandFor({
          operation: 'invitation:decide',
          resourceId: intent.id,
          payload: body,
        })
        const result = await studioApi.decideTeamInvitation(body, command)
        organizationId = result.organization_id
        accepted = result.intent.status === 'accepted'
      } else {
        const body = { token: flow.token, intent_id: resolved.invitation.intent.id, decision }
        const command = decisionCommandIntent.commandFor({
          operation: 'invitation:decide',
          resourceId: resolved.invitation.intent.id,
          payload: body,
        })
        const result = await studioApi.decideOwnershipInvitation(body, command)
        organizationId = result.organization_id
        accepted = result.intent.status === 'accepted'
      }
      decisionCommandIntent.reset()
      clearPendingInvitationToken()
      if (accepted) {
        router.replace(`/organizations/${organizationId}`)
        return
      }
      setFlow({ kind: 'rejected', description: rejectionDescription(resolved) })
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 403) {
        decisionCommandIntent.reset()
        setFlow({ kind: 'mismatch' })
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
            resolved: flow.resolved,
            authenticated: true,
          })
        }
        onSessionExpired={() =>
          setFlow({
            kind: 'ready',
            token: flow.token,
            resolved: flow.resolved,
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
      <InvitationMessage title="Rechazaste la invitación" description={flow.description}>
        <Button onClick={() => router.replace('/')}>Volver a Studio</Button>
      </InvitationMessage>
    )
  }

  const actions = flow.authenticated ? (
    <SetupPanelActions>
      <Button onClick={() => void decide('accepted')} disabled={Boolean(deciding)}>
        {deciding === 'accepted'
          ? 'Aceptando…'
          : flow.resolved.kind === 'ownership'
            ? 'Aceptar y recibir la organización'
            : 'Aceptar invitación'}
      </Button>
      <Button
        variant="outline"
        onClick={() => void decide('rejected')}
        disabled={Boolean(deciding)}
      >
        {deciding === 'rejected' ? 'Rechazando…' : 'Rechazar'}
      </Button>
    </SetupPanelActions>
  ) : (
    <SetupPanelActions>
      <a
        className={buttonVariants({ size: 'lg' })}
        href={`${studioApi.apiUrl}/studio/v1/auth/start`}
        onClick={prepareStudioAuthentication}
      >
        Entrar para decidir
      </a>
      <Badge variant="warning">Debes usar el correo invitado</Badge>
    </SetupPanelActions>
  )

  if (flow.resolved.kind === 'ownership') {
    const invitation = flow.resolved.invitation
    return (
      <StudioFrame step="identity" showLogout={flow.authenticated}>
        <SetupPanel>
          <SetupPanelIntro>
            <SetupPanelEyebrow>Entrega de organización</SetupPanelEyebrow>
            <SetupPanelTitle>
              {invitation.organization.display_name} está lista para que la recibas.
            </SetupPanelTitle>
            <SetupPanelDescription>
              Allfit la preparó para ti. Aceptarla te hace su propietario y la organización empieza
              a operar; mientras no la aceptes, existe pero no opera.
            </SetupPanelDescription>
          </SetupPanelIntro>
          <SetupPanelContent>
            <Card>
              <CardContent>
                <dl data-ownership-invitation-summary>
                  <div>
                    <dt>Organización</dt>
                    <dd>{invitation.organization.display_name}</dd>
                  </div>
                  <div>
                    <dt>Tipo</dt>
                    <dd>{invitation.organization.type_name}</dd>
                  </div>
                  <div>
                    <dt>Responsable</dt>
                    <dd>
                      {invitation.organization.party_kind === 'legal_entity'
                        ? (invitation.organization.legal_name ?? 'Empresa')
                        : 'Tú, con el nombre de tu cuenta'}
                    </dd>
                  </div>
                  <div>
                    <dt>Sede</dt>
                    <dd>{invitation.organization.site_name ?? 'Sin sede declarada'}</dd>
                  </div>
                  <div>
                    <dt>Vigencia</dt>
                    <dd>{formatDate(invitation.expires_at)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            {actions}
          </SetupPanelContent>
        </SetupPanel>
      </StudioFrame>
    )
  }

  const invitation = flow.resolved.invitation
  const intent = invitation.intents[0]
  return (
    <StudioFrame step="identity" showLogout={flow.authenticated}>
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Invitación de equipo</SetupPanelEyebrow>
          <SetupPanelTitle>
            {invitation.organization.display_name} quiere sumarte a su equipo.
          </SetupPanelTitle>
          <SetupPanelDescription>
            Revisa la propuesta antes de decidir. Aceptarla crea solo una membresía de equipo en
            Studio.
          </SetupPanelDescription>
        </SetupPanelIntro>
        <SetupPanelContent>
          <Card>
            <CardContent>
              <dl data-team-invitation-summary>
                <div>
                  <dt>Organización</dt>
                  <dd>{invitation.organization.display_name}</dd>
                </div>
                <div>
                  <dt>Responsable</dt>
                  <dd>{invitation.organization.responsible_party.name}</dd>
                </div>
                <div>
                  <dt>Rol propuesto</dt>
                  <dd>{intent ? invitationRoleLabel(intent.proposed_role_code) : 'Equipo'}</dd>
                </div>
                <div>
                  <dt>Vigencia</dt>
                  <dd>{formatDate(invitation.expires_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          {actions}
        </SetupPanelContent>
      </SetupPanel>
    </StudioFrame>
  )
}

/**
 * A team token is tried first because it is the common case. Only a token that is
 * not one is asked about as an ownership invitation; both answer 404 alike otherwise.
 */
async function resolveInvitation(token: string): Promise<Resolved> {
  try {
    return { kind: 'team', invitation: await studioApi.resolveTeamInvitation(token) }
  } catch (error) {
    if (!(error instanceof StudioApiError) || error.status !== 404) throw error
  }
  return { kind: 'ownership', invitation: await studioApi.resolveOwnershipInvitation(token) }
}

function rejectionDescription(resolved: Resolved): string {
  return resolved.kind === 'team'
    ? `No se creó ninguna membresía en ${resolved.invitation.organization.display_name}.`
    : `No quedaste como propietario de ${resolved.invitation.organization.display_name}, y sigue sin operar.`
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
