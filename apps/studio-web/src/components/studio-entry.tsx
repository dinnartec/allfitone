'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { AccessLanding } from './access-landing'
import { ActivationForm } from './activation-form'
import { MembershipSelector } from './membership-selector'
import { SpaceSetup } from './space-setup'
import { LoadingStage, StudioFrame } from './studio-frame'
import { resolveMembershipDestination } from '@/lib/membership-routing'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type Membership,
  type OnboardingAttempt,
  type OrganizationType,
} from '@/lib/studio-api'

type FlowState =
  | { kind: 'loading' }
  | { kind: 'access' }
  | { kind: 'activation'; attempt: OnboardingAttempt }
  | { kind: 'space'; organizationTypes: OrganizationType[]; fullName?: string }
  | { kind: 'select'; memberships: Membership[] }
  | { kind: 'error'; message: string }

export function StudioEntry() {
  const router = useRouter()
  const [flow, setFlow] = useState<FlowState>({ kind: 'loading' })

  const resolveMemberships = useCallback(
    async (fullName?: string) => {
      const [membershipList, typeList] = await Promise.all([
        studioApi.memberships(),
        studioApi.organizationTypes(),
      ])
      const destination = resolveMembershipDestination(membershipList.items)
      if (destination.kind === 'organization') {
        router.replace(`/organizations/${destination.organizationId}`)
        return
      }
      if (destination.kind === 'select') {
        setFlow({ kind: 'select', memberships: destination.memberships })
        return
      }
      setFlow({
        kind: 'space',
        organizationTypes: typeList.items,
        ...(fullName ? { fullName } : {}),
      })
    },
    [router],
  )

  const bootstrap = useCallback(async () => {
    setFlow({ kind: 'loading' })
    try {
      const session = await studioApi.session()
      if (session.registration_status === 'registration_incomplete') {
        const attempt = await studioApi.startAttempt(newCommand())
        setFlow({ kind: 'activation', attempt })
        return
      }
      await resolveMemberships()
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
  }, [resolveMemberships])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  if (flow.kind === 'loading') return <LoadingStage />
  if (flow.kind === 'access') return <AccessLanding />
  if (flow.kind === 'activation') {
    return (
      <ActivationForm
        attempt={flow.attempt}
        onComplete={(fullName) => void resolveMemberships(fullName)}
        onSessionExpired={() => setFlow({ kind: 'access' })}
        onRetryAttempt={async () => {
          const attempt = await studioApi.startAttempt(newCommand())
          setFlow({ kind: 'activation', attempt })
        }}
      />
    )
  }
  if (flow.kind === 'space') {
    return (
      <SpaceSetup
        organizationTypes={flow.organizationTypes}
        fullName={flow.fullName}
        onCreated={(organizationId) => router.replace(`/organizations/${organizationId}`)}
        onSessionExpired={() => setFlow({ kind: 'access' })}
      />
    )
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
