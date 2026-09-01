'use client'

import { ProductWordmark } from '@allfitone/react/brand'
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
  useMemo,
  useRef,
  useState,
} from 'react'

import { LogoutForm } from './logout-form'
import { useStudioEntryContext } from './studio-entry-context'
import { resolveOrganizationContext } from '@/lib/membership-routing'
import { StudioApiError, studioApi, type Membership } from '@/lib/studio-api'

interface OrganizationContextValue {
  current: Membership
  memberships: Membership[]
  reload: () => void
  switchOrganization: (organizationId: string) => void
}

type VerificationState = 'idle' | 'checking' | 'error'

type OrganizationContextState =
  | { kind: 'loading'; label: string }
  | {
      kind: 'ready'
      current: Membership
      memberships: Membership[]
      verification: VerificationState
    }
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
  const entryContext = useStudioEntryContext()
  const [state, setState] = useState<OrganizationContextState>(() =>
    stateFromSnapshot(entryContext.freshMemberships(), organizationId),
  )
  const mounted = useRef(true)
  const requestController = useRef<AbortController | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const lastVerifiedAt = useRef(0)
  const loadedOrganizationId = useRef(organizationId)

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current

    const controller = new AbortController()
    requestController.current = controller
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, verification: 'checking' }
        : { kind: 'loading', label: 'Comprobando tu acceso…' },
    )

    const request = (async () => {
      try {
        const { items } = await studioApi.memberships(controller.signal)
        if (!mounted.current || controller.signal.aborted) return
        entryContext.storeMemberships(items)
        lastVerifiedAt.current = Date.now()
        const resolved = resolveOrganizationContext(items, organizationId)
        setState(
          resolved.kind === 'ready' ? { ...resolved, verification: 'idle' } : { kind: 'forbidden' },
        )
      } catch (caught) {
        if (!mounted.current || controller.signal.aborted) return
        if (caught instanceof StudioApiError && caught.status === 401) {
          router.replace('/')
          return
        }
        // A denial is terminal, not a blip. shouldRetryStudioQuery never retries
        // a 403, so the transient-failure screen would offer a retry that cannot
        // succeed. The contract declares 403 on this operation, and every
        // screen-level list already separates the two.
        if (caught instanceof StudioApiError && caught.status === 403) {
          setState({ kind: 'forbidden' })
          return
        }
        setState((current) =>
          current.kind === 'ready' ? { ...current, verification: 'error' } : { kind: 'error' },
        )
      }
    })()

    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
      if (requestController.current === controller) requestController.current = null
    })
    return request
  }, [entryContext, organizationId, router])

  useEffect(() => {
    mounted.current = true
    if (loadedOrganizationId.current !== organizationId) {
      loadedOrganizationId.current = organizationId
      requestController.current?.abort()
      requestController.current = null
      inFlight.current = null
    }
    const cached = resolveFreshOrganization(entryContext.freshMemberships(), organizationId)
    if (cached) {
      lastVerifiedAt.current = Date.now()
      setState({ ...cached, verification: 'idle' })
    } else void load()

    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current) return
        requestController.current?.abort()
        requestController.current = null
        inFlight.current = null
      })
    }
  }, [entryContext, load, organizationId])

  useEffect(() => {
    const revalidate = () => {
      if (Date.now() - lastVerifiedAt.current < 1_000) return
      void load()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') revalidate()
    }
    const onPageShow = () => revalidate()

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
      requestController.current?.abort()
      requestController.current = null
      inFlight.current = null
      setState({ kind: 'loading', label: 'Cambiando de organización…' })
      router.replace(`/organizations/${nextOrganizationId}`)
    },
    [organizationId, router],
  )

  const value = useMemo<OrganizationContextValue | undefined>(
    () =>
      state.kind === 'ready'
        ? {
            current: state.current,
            memberships: state.memberships,
            reload: () => void load(),
            switchOrganization,
          }
        : undefined,
    [load, state, switchOrganization],
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
        <OrganizationVerificationError onRetry={() => void load()} />
      </OrganizationStateFrame>
    )
  }
  if (!value) return null

  const blocked = state.verification !== 'idle'
  return (
    <OrganizationContext value={value}>
      <div data-organization-context-root>
        <div
          data-organization-protected-content
          inert={blocked ? true : undefined}
          aria-hidden={blocked ? true : undefined}
        >
          {children}
        </div>
        {blocked ? (
          <div data-organization-verification-overlay>
            {state.verification === 'checking' ? (
              <div data-organization-state role="status" aria-live="polite">
                <Spinner label="Comprobando tu acceso…" />
                <p>Comprobando tu acceso…</p>
              </div>
            ) : (
              <OrganizationVerificationError onRetry={() => void load()} />
            )}
          </div>
        ) : null}
      </div>
    </OrganizationContext>
  )
}

export function useOrganizationContext(): OrganizationContextValue {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('useOrganizationContext requires OrganizationContextBoundary')
  return value
}

function stateFromSnapshot(
  memberships: Membership[] | undefined,
  organizationId: string,
): OrganizationContextState {
  const ready = resolveFreshOrganization(memberships, organizationId)
  return ready
    ? { ...ready, verification: 'idle' }
    : { kind: 'loading', label: 'Comprobando tu acceso…' }
}

function resolveFreshOrganization(
  memberships: Membership[] | undefined,
  organizationId: string,
): Extract<OrganizationContextState, { kind: 'ready' }> | undefined {
  if (!memberships) return undefined
  const resolved = resolveOrganizationContext(memberships, organizationId)
  return resolved.kind === 'ready' ? { ...resolved, verification: 'idle' } : undefined
}

function OrganizationVerificationError({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-organization-state>
      <Alert variant="danger" live="assertive">
        <AlertTitle>No pudimos comprobar tu acceso</AlertTitle>
        <AlertDescription>
          La conexión falló de forma temporal. El contenido permanecerá bloqueado hasta comprobar
          nuevamente tu membresía.
        </AlertDescription>
        <Button onClick={onRetry}>Reintentar</Button>
      </Alert>
    </div>
  )
}

function OrganizationStateFrame({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell data-organization-state-shell>
      <WorkspaceMain>
        <WorkspaceHeader>
          <ProductWordmark
            product="studio"
            surface="light"
            title="Allfit Studio"
            width={138}
            height={28}
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
