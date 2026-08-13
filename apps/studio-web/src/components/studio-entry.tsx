'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AccessLanding } from './access-landing'
import { ActivationForm } from './activation-form'
import { InvitationWaiting } from './invitation-waiting'
import { MembershipSelector } from './membership-selector'
import { OrganizationReadyScreen } from './organization-ready-screen'
import { SpaceSetup } from './space-setup'
import { LoadingStage, StudioFrame } from './studio-frame'
import { resolveMembershipDestination } from '@/lib/membership-routing'
import { readPendingInvitationToken } from '@/lib/invitation-token'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type Membership,
  type OrganizationCreated,
  type OnboardingAttempt,
  type OrganizationType,
  type StudioSession,
} from '@/lib/studio-api'

type FlowState =
  | { kind: 'loading' }
  | { kind: 'access' }
  | { kind: 'activation'; attempt: OnboardingAttempt; identity: StudioSession['identity'] }
  | { kind: 'space'; organizationTypes: OrganizationType[]; fullName?: string }
  | { kind: 'ready'; organization: OrganizationCreated }
  | { kind: 'waiting' }
  | { kind: 'select'; memberships: Membership[] }
  | { kind: 'error'; message: string }

export function StudioEntry({ logoutPartial = false }: { logoutPartial?: boolean }) {
  const router = useRouter()
  const [flow, setFlow] = useState<FlowState>({ kind: 'loading' })
  const bootstrapStarted = useRef(false)

  const resolveMemberships = useCallback(
    async (fullName?: string, emptyDestination: 'space' | 'waiting' = 'space') => {
      const membershipList = await studioApi.memberships()
      const destination = resolveMembershipDestination(membershipList.items)
      if (destination.kind === 'organization') {
        router.replace(`/organizations/${destination.organizationId}`)
        return
      }
      if (destination.kind === 'select') {
        setFlow({ kind: 'select', memberships: destination.memberships })
        return
      }
      if (emptyDestination === 'waiting') {
        setFlow({ kind: 'waiting' })
        return
      }
      const typeList = await studioApi.organizationTypes()
      setFlow({
        kind: 'space',
        organizationTypes: typeList.items,
        ...(fullName ? { fullName } : {}),
      })
    },
    [router],
  )

  const checkWaitingMemberships = useCallback(async () => {
    try {
      await resolveMemberships(undefined, 'waiting')
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        setFlow({ kind: 'access' })
        return
      }
      throw caught
    }
  }, [resolveMemberships])

  const bootstrap = useCallback(async () => {
    setFlow({ kind: 'loading' })
    if (readPendingInvitationToken()) {
      router.replace('/invitations')
      return
    }
    try {
      const session = await studioApi.session()
      const fullName = identityName(session.identity)
      if (session.registration_status === 'registration_incomplete') {
        const attempt = await studioApi.startAttempt(newCommand())
        setFlow({ kind: 'activation', attempt, identity: session.identity })
        return
      }
      await resolveMemberships(fullName)
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        setFlow({ kind: 'access' })
        return
      }
      setFlow({
        kind: 'error',
        message:
          caught instanceof StudioApiError && caught.status === 503
            ? 'El servicio de identidad no está disponible en este momento.'
            : 'No pudimos determinar el estado de tu cuenta.',
      })
    }
  }, [resolveMemberships, router])

  useEffect(() => {
    if (bootstrapStarted.current) return
    bootstrapStarted.current = true
    void bootstrap()
  }, [bootstrap])

  if (flow.kind === 'loading') return <LoadingStage />
  if (flow.kind === 'access') return <AccessLanding logoutPartial={logoutPartial} />
  if (flow.kind === 'activation') {
    return (
      <ActivationForm
        attempt={flow.attempt}
        identity={flow.identity}
        onComplete={(fullName) => void resolveMemberships(fullName)}
        onSessionExpired={() => setFlow({ kind: 'access' })}
        onRetryAttempt={async () => {
          const attempt = await studioApi.startAttempt(newCommand())
          setFlow({ kind: 'activation', attempt, identity: flow.identity })
        }}
      />
    )
  }
  if (flow.kind === 'space') {
    return (
      <SpaceSetup
        organizationTypes={flow.organizationTypes}
        fullName={flow.fullName}
        onCreated={(organization) => setFlow({ kind: 'ready', organization })}
        onWait={() => setFlow({ kind: 'waiting' })}
        onSessionExpired={() => setFlow({ kind: 'access' })}
      />
    )
  }
  if (flow.kind === 'ready') {
    return (
      <OrganizationReadyScreen
        organization={flow.organization}
        onEnter={() => router.replace(`/organizations/${flow.organization.id}`)}
      />
    )
  }
  if (flow.kind === 'waiting') {
    return <InvitationWaiting onCheck={checkWaitingMemberships} />
  }
  if (flow.kind === 'select') {
    return (
      <MembershipSelector
        memberships={flow.memberships}
        onSelect={(organizationId) => router.replace(`/organizations/${organizationId}`)}
      />
    )
  }
  return (
    <StudioFrame step="identity" showLogout={false}>
      <div data-studio-error-stage>
        <Alert variant="danger" live="assertive">
          <AlertTitle>No pudimos abrir Studio</AlertTitle>
          <AlertDescription>{flow.message}</AlertDescription>
          <Button onClick={() => void bootstrap()}>Reintentar</Button>
        </Alert>
      </div>
    </StudioFrame>
  )
}

function identityName(identity: StudioSession['identity']): string | undefined {
  const fullName = [identity.given_name, identity.family_name].filter(Boolean).join(' ').trim()
  return fullName || undefined
}
