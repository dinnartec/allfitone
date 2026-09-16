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

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Card, CardContent } from '@allfitone/react/components/card'
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
import { isStudioForbidden } from '@/lib/studio-query'
import { invitationRoleLabel } from '@/lib/team-invitations'

type Resolved =
  | { kind: 'team'; invitation: TeamInvitationPresentation }
  | { kind: 'ownership'; invitation: OwnershipInvitationPresentation }

type Flow =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | {
      kind: 'ready'
      token: string
      resolved: Resolved
      authenticated: boolean
      onboarding: boolean
    }
  | {
      kind: 'activation'
      token: string
      resolved: Resolved
      attempt: OnboardingAttempt
      identity: StudioEntryContext['identity']
    }
  | { kind: 'mismatch' }
  | { kind: 'rejected'; description: string }
  // `title` is per-stage: "No pudimos abrir la invitación" and "No pudimos
  // guardar tu decisión" are different failures and said so to the same screen.
  | { kind: 'error'; title: string; message: string }

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
        setFlow({ kind: 'ready', token, resolved, authenticated: false, onboarding: false })
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
      setFlow({
        kind: 'ready',
        token,
        resolved,
        authenticated: true,
        onboarding: await isOnboarding(),
      })
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 404) {
        clearPendingInvitationToken()
        setFlow({ kind: 'invalid' })
        return
      }
      setFlow({
        kind: 'error',
        title: 'No pudimos abrir la invitación',
        // Not a repeat of the title: a rejected link answers 404 and lands on
        // the unavailable stage instead, so reaching here means the link is not
        // what failed — which is the one thing worth telling this person.
        message:
          error instanceof StudioApiError && error.status === 429
            ? 'Se hicieron demasiados intentos. Espera un momento antes de volver a abrir la invitación.'
            : 'No fue el enlace: el servicio no está disponible en este momento.',
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
      if (isStudioForbidden(error)) {
        decisionCommandIntent.reset()
        setFlow({ kind: 'mismatch' })
      } else if (error instanceof StudioApiError && error.status === 404) {
        decisionCommandIntent.reset()
        clearPendingInvitationToken()
        setFlow({ kind: 'invalid' })
      } else {
        setFlow({
          kind: 'error',
          title: 'No pudimos guardar tu decisión',
          // The decision carries a command id that survives a retry, so
          // repeating it cannot record the answer twice.
          message: 'Vuelve a intentarlo. Si ya se había registrado, no se duplicará.',
        })
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
        onComplete={async () =>
          setFlow({
            kind: 'ready',
            token: flow.token,
            resolved: flow.resolved,
            authenticated: true,
            onboarding: await isOnboarding(),
          })
        }
        onSessionExpired={() =>
          setFlow({
            kind: 'ready',
            token: flow.token,
            resolved: flow.resolved,
            authenticated: false,
            onboarding: false,
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
      // The only terminal stage that offered no way out. Every path here clears
      // the stored token first or never had one, so returning to `/` cannot
      // bounce back to `/invitations`, and `/` routes each person on its own.
      <InvitationMessage
        title="Esta invitación ya no está disponible"
        description="Puede haber vencido, sido revocada o ya haberse decidido. Si aún quieres unirte, pide a quien te invitó que te envíe una nueva."
      >
        <Button onClick={() => router.replace('/')}>Volver a Studio</Button>
      </InvitationMessage>
    )
  }
  if (flow.kind === 'error') {
    return (
      <InvitationMessage title={flow.title} description={flow.message}>
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

  // The same screen serves two people. For someone with no space yet, accepting
  // is how they get their first one, so this is step two of their setup and the
  // bar says so — it follows the identity step `ActivationForm` shows just
  // before. For someone who already belongs to an organization it is not setup
  // at all, and the bar would claim a position they are not in. Both panels
  // read the same flag: receiving an organization is no more a setup step than
  // joining a team when the person already runs one.
  const stage = flow.onboarding ? { step: 'space' as const } : {}

  // An instruction, not an action or a status. As a warning badge in the action
  // row it read as a second button, and "el correo invitado" invites an address
  // rather than a person.
  const signInNote = flow.authenticated ? null : (
    <SetupPanelNote>
      <FoundationIcon name="person" decorative />
      Entra con el correo que recibió la invitación.
    </SetupPanelNote>
  )

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
    </SetupPanelActions>
  )

  if (flow.resolved.kind === 'ownership') {
    const invitation = flow.resolved.invitation
    return (
      <StudioFrame {...stage} showLogout={flow.authenticated}>
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
            {signInNote}
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
    <StudioFrame {...stage} showLogout={flow.authenticated}>
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Invitación de equipo</SetupPanelEyebrow>
          {/* The organization is the headline, not a phrase wrapped around it.
              Inside the sentence, a 39-character name took this title to six
              lines and 346px; the verb belongs in the description. */}
          <SetupPanelTitle>{invitation.organization.display_name}</SetupPanelTitle>
          {/* The eyebrow above already says this is a team invitation and the
              title says who sent it, so an opening sentence repeating both only
              spent a third "equipo" in five lines. */}
          <SetupPanelDescription>
            Revisa la propuesta antes de decidir: aceptarla crea solo una membresía de equipo en
            Studio.
          </SetupPanelDescription>
          {signInNote}
        </SetupPanelIntro>
        <SetupPanelContent>
          <Card>
            <CardContent>
              {/* No "Organización" row: the title above is the organization's
                  name, so repeating it here read as two answers to one question. */}
              <dl data-team-invitation-summary>
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
  // No step either: this frame is shared by four terminal stages — invalid,
  // mismatch, rejected and error — so it told someone who had just declined an
  // invitation that they were on step one of three of a setup with no next step.
  return (
    <StudioFrame showLogout={false}>
      <div data-studio-error-stage>
        <Alert variant="warning" live="polite">
          {/* Shared by the invalid, mismatch, rejected and error stages. Each
              replaces the page, so this title is the page heading. */}
          <AlertTitle role="heading" aria-level={1}>
            {title}
          </AlertTitle>
          <AlertDescription>{description}</AlertDescription>
          {/* In the slot, not loose. Passed through `children`, the action
              auto-placed into the icon's column and sized it — the fault fixed
              in fifteen other alerts, missed here because the button arrives
              from the call site rather than being written inside `<Alert>`. */}
          {children ? <AlertAction>{children}</AlertAction> : null}
        </Alert>
      </div>
    </StudioFrame>
  )
}

/**
 * Whether this person holds no active space yet, which is what makes accepting
 * an invitation a setup step for them.
 *
 * It never blocks the decision. The progress bar is orientation, not access: if
 * the read fails, the screen still offers Accept and Reject and simply makes no
 * claim about which step the person is on.
 */
async function isOnboarding(): Promise<boolean> {
  try {
    const { items } = await studioApi.memberships()
    return !items.some((membership) => membership.status === 'active')
  } catch {
    return false
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(value))
}
