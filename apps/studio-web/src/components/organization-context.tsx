'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { organizationTypeLabel } from './membership-selector'
import { LoadingStage, StudioFrame } from './studio-frame'
import { resolveOrganizationContext } from '@/lib/membership-routing'
import { membershipRoleSummary } from '@/lib/membership-roles'
import { StudioApiError, studioApi, type Membership } from '@/lib/studio-api'

interface OrganizationContextValue {
  current: Membership
  memberships: Membership[]
  reload: () => void
  switchOrganization: (organizationId: string) => void
}

type OrganizationContextState =
  | { kind: 'loading'; label: string }
  | { kind: 'ready'; current: Membership; memberships: Membership[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

export function OrganizationContextBoundary({
  organizationId,
  children,
}: {
  organizationId: string
  children: ReactNode
}) {
  const router = useRouter()
  const [state, setState] = useState<OrganizationContextState>({
    kind: 'loading',
    label: 'Comprobando tu acceso…',
  })
  const requestId = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    requestController.current = controller
    setState({ kind: 'loading', label: 'Comprobando tu acceso…' })

    try {
      const { items } = await studioApi.memberships(controller.signal)
      if (controller.signal.aborted || currentRequest !== requestId.current) return
      setState(resolveOrganizationContext(items, organizationId))
    } catch (caught) {
      if (controller.signal.aborted || currentRequest !== requestId.current) return
      if (caught instanceof StudioApiError && caught.status === 401) {
        router.replace('/')
        return
      }
      setState({ kind: 'error' })
    }
  }, [organizationId, router])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
      requestController.current?.abort()
    }
  }, [load])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const onPageShow = () => void load()

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [load])

  const switchOrganization = useCallback(
    (nextOrganizationId: string) => {
      if (nextOrganizationId === organizationId) return
      requestId.current += 1
      requestController.current?.abort()
      setState({ kind: 'loading', label: 'Cambiando de organización…' })
      router.replace(`/organizations/${nextOrganizationId}`)
    },
    [organizationId, router],
  )

  if (state.kind === 'loading') return <LoadingStage label={state.label} />
  if (state.kind === 'forbidden') {
    return (
      <StudioFrame step="ready">
        <div data-studio-error-stage>
          <Alert variant="warning">
            <AlertTitle>Este espacio no está disponible</AlertTitle>
            <AlertDescription>
              No tienes una membresía activa para esta organización.
            </AlertDescription>
            <Button onClick={() => router.replace('/')}>Elegir otro espacio</Button>
          </Alert>
        </div>
      </StudioFrame>
    )
  }
  if (state.kind === 'error') {
    return (
      <StudioFrame step="ready">
        <div data-studio-error-stage>
          <Alert variant="danger" live="assertive">
            <AlertTitle>No pudimos comprobar tu acceso</AlertTitle>
            <AlertDescription>
              La conexión falló de forma temporal. El contenido permanecerá bloqueado hasta
              comprobar nuevamente tu membresía.
            </AlertDescription>
            <Button onClick={() => void load()}>Reintentar</Button>
          </Alert>
        </div>
      </StudioFrame>
    )
  }

  const value: OrganizationContextValue = {
    current: state.current,
    memberships: state.memberships,
    reload: () => void load(),
    switchOrganization,
  }

  return (
    <OrganizationContext value={value}>
      <StudioFrame step="ready">
        <article data-workspace>
          <OrganizationContextHeader
            current={state.current}
            memberships={state.memberships}
            onSwitch={switchOrganization}
          />
          <div key={state.current.organization_id} data-workspace-content>
            {children}
          </div>
        </article>
      </StudioFrame>
    </OrganizationContext>
  )
}

export function useOrganizationContext(): OrganizationContextValue {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('useOrganizationContext requires OrganizationContextBoundary')
  return value
}

function OrganizationContextHeader({
  current,
  memberships,
  onSwitch,
}: {
  current: Membership
  memberships: Membership[]
  onSwitch: (organizationId: string) => void
}) {
  return (
    <header data-workspace-heading aria-label={`Organización activa: ${current.display_name}`}>
      <div>
        <p data-studio-eyebrow>{organizationTypeLabel(current.type_code)}</p>
        <h1>{current.display_name}</h1>
        <p>Estás trabajando en esta organización.</p>
      </div>
      <div data-workspace-context-controls>
        <div data-workspace-identity aria-label="Roles en la organización activa">
          <Badge variant="success">Organización activa</Badge>
          <Badge variant="sport">{membershipRoleSummary(current.roles)}</Badge>
        </div>
        {memberships.length > 1 ? (
          <div data-workspace-switcher>
            <label htmlFor="organization-switcher">Cambiar de organización</label>
            <Select
              value={current.organization_id}
              onValueChange={(value) => {
                if (value !== null) onSwitch(value)
              }}
              items={memberships.map((membership) => ({
                label: `${membership.display_name} · ${membershipRoleSummary(membership.roles)}`,
                value: membership.organization_id,
              }))}
            >
              <SelectTrigger id="organization-switcher" data-studio-select-trigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {memberships.map((membership) => (
                  <SelectItem key={membership.membership_id} value={membership.organization_id}>
                    {membership.display_name} · {membershipRoleSummary(membership.roles)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </header>
  )
}
