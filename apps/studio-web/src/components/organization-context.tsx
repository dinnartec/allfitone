'use client'

import { ProductLockup } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Spinner } from '@allfitone/react/components/spinner'
import {
  WorkspaceActions,
  WorkspaceContent,
  WorkspaceHeader,
  WorkspaceMain,
  WorkspaceShell,
} from '@allfitone/react/components/workspace-shell'
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

import { LogoutForm } from './logout-form'
import { resolveOrganizationContext } from '@/lib/membership-routing'
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

  if (state.kind === 'loading') {
    return (
      <OrganizationStateFrame>
        <div data-organization-state role="status" aria-live="polite">
          <Spinner label={state.label} />
          <p>{state.label}</p>
        </div>
      </OrganizationStateFrame>
    )
  }
  if (state.kind === 'forbidden') {
    return (
      <OrganizationStateFrame>
        <div data-organization-state>
          <Alert variant="warning">
            <AlertTitle>Este espacio no está disponible</AlertTitle>
            <AlertDescription>
              No tienes una membresía activa para esta organización.
            </AlertDescription>
            <Button onClick={() => router.replace('/')}>Elegir otro espacio</Button>
          </Alert>
        </div>
      </OrganizationStateFrame>
    )
  }
  if (state.kind === 'error') {
    return (
      <OrganizationStateFrame>
        <div data-organization-state>
          <Alert variant="danger" live="assertive">
            <AlertTitle>No pudimos comprobar tu acceso</AlertTitle>
            <AlertDescription>
              La conexión falló de forma temporal. El contenido permanecerá bloqueado hasta
              comprobar nuevamente tu membresía.
            </AlertDescription>
            <Button onClick={() => void load()}>Reintentar</Button>
          </Alert>
        </div>
      </OrganizationStateFrame>
    )
  }

  const value: OrganizationContextValue = {
    current: state.current,
    memberships: state.memberships,
    reload: () => void load(),
    switchOrganization,
  }

  return (
    <OrganizationContext value={value} key={state.current.organization_id}>
      {children}
    </OrganizationContext>
  )
}

export function useOrganizationContext(): OrganizationContextValue {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('useOrganizationContext requires OrganizationContextBoundary')
  return value
}

function OrganizationStateFrame({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell data-organization-state-shell>
      <WorkspaceMain>
        <WorkspaceHeader>
          <ProductLockup
            product="studio"
            surface="light"
            title="Allfit Studio"
            width={169}
            height={40}
          />
          <WorkspaceActions>
            <LogoutForm />
          </WorkspaceActions>
        </WorkspaceHeader>
        <WorkspaceContent>{children}</WorkspaceContent>
      </WorkspaceMain>
    </WorkspaceShell>
  )
}
