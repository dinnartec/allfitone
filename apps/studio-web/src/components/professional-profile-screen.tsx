'use client'

import { ProductLockup } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Spinner } from '@allfitone/react/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allfitone/react/components/tabs'
import { Toaster } from '@allfitone/react/components/sonner'
import {
  WorkspaceActions,
  WorkspaceContent,
  WorkspaceEyebrow,
  WorkspaceHeader,
  WorkspaceHeading,
  WorkspaceMain,
  WorkspaceShell,
  WorkspaceTitle,
} from '@allfitone/react/components/workspace-shell'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { ProfessionalCredentials } from './professional-credentials'
import { ProfessionalMemberships } from './professional-memberships'
import { ProfessionalPresentation } from './professional-presentation'
import {
  StudioApiError,
  studioApi,
  type ProfessionalCatalogItem,
  type StudioMe,
} from '@/lib/studio-api'

type ProfileState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      me: StudioMe
      specialties: ProfessionalCatalogItem[]
      credentialTypes: ProfessionalCatalogItem[]
    }
  | { kind: 'error'; retryable: boolean }

export function ProfessionalProfileScreen() {
  const router = useRouter()
  const [state, setState] = useState<ProfileState>({ kind: 'loading' })

  const routeSessionFailure = useCallback(
    (error: unknown): boolean => {
      if (
        error instanceof StudioApiError &&
        (error.status === 401 || error.code === 'registration-incomplete')
      ) {
        router.replace('/')
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const [me, specialtyList, credentialTypeList] = await Promise.all([
        studioApi.me(),
        studioApi.professionalSpecialties(),
        studioApi.professionalCredentialTypes(),
      ])
      setState({
        kind: 'ready',
        me,
        specialties: specialtyList.items,
        credentialTypes: credentialTypeList.items,
      })
    } catch (error) {
      if (routeSessionFailure(error)) return
      setState({
        kind: 'error',
        retryable: error instanceof StudioApiError && error.status === 503,
      })
    }
  }, [routeSessionFailure])

  const refreshMe = useCallback(async (): Promise<StudioMe | undefined> => {
    try {
      const me = await studioApi.me()
      setState((current) => (current.kind === 'ready' ? { ...current, me } : current))
      return me
    } catch (error) {
      if (!routeSessionFailure(error)) throw error
      return undefined
    }
  }, [routeSessionFailure])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ProfileShell onSpaces={() => router.push('/')}>
      {state.kind === 'loading' ? (
        <div data-profile-state role="status" aria-live="polite">
          <Spinner label="Cargando tu perfil" />
          <p>Reuniendo tu presentación y credenciales…</p>
        </div>
      ) : state.kind === 'error' ? (
        <div data-profile-state>
          <Alert variant="danger" live="assertive">
            <AlertTitle>No pudimos abrir tu perfil</AlertTitle>
            <AlertDescription>
              {state.retryable
                ? 'El servicio no está disponible en este momento. Puedes reintentar sin perder información.'
                : 'Ocurrió un error al reunir tu información profesional.'}
            </AlertDescription>
            <Button onClick={() => void load()}>Reintentar</Button>
          </Alert>
        </div>
      ) : (
        <ProfileReady
          state={state}
          onSessionFailure={routeSessionFailure}
          onRefreshMe={refreshMe}
          onMeChange={(me) =>
            setState((current) => (current.kind === 'ready' ? { ...current, me } : current))
          }
        />
      )}
    </ProfileShell>
  )
}

function ProfileReady({
  state,
  onSessionFailure,
  onRefreshMe,
  onMeChange,
}: {
  state: Extract<ProfileState, { kind: 'ready' }>
  onSessionFailure: (error: unknown) => boolean
  onRefreshMe: () => Promise<StudioMe | undefined>
  onMeChange: (me: StudioMe) => void
}) {
  const profile = state.me.profile
  return (
    <>
      <WorkspaceHeading data-profile-heading>
        <div>
          <WorkspaceEyebrow>Perfil profesional opcional</WorkspaceEyebrow>
          <WorkspaceTitle>{profile?.headline ?? 'Tu experiencia, en tus palabras.'}</WorkspaceTitle>
          <p>
            Complétalo solo si entrenas o prestas servicios profesionales. Si únicamente administras
            un espacio, no lo necesitas. Nunca modifica tus permisos.
          </p>
        </div>
        <Badge variant={profile ? 'success' : 'outline'}>
          {profile ? 'Perfil creado' : 'Opcional'}
        </Badge>
      </WorkspaceHeading>

      <Tabs defaultValue="presentation" data-profile-tabs>
        <TabsList variant="line" aria-label="Secciones de mi perfil">
          <TabsTrigger value="presentation">Presentación</TabsTrigger>
          <TabsTrigger value="credentials">Credenciales</TabsTrigger>
          <TabsTrigger value="spaces">Mis espacios</TabsTrigger>
        </TabsList>
        <TabsContent value="presentation">
          <ProfessionalPresentation
            profile={profile}
            specialties={state.specialties}
            onSessionFailure={onSessionFailure}
            onSaved={(savedProfile) => onMeChange({ ...state.me, profile: savedProfile })}
          />
        </TabsContent>
        <TabsContent value="credentials">
          <ProfessionalCredentials
            credentials={profile?.credentials ?? []}
            credentialTypes={state.credentialTypes}
            profileExists={Boolean(profile)}
            onSessionFailure={onSessionFailure}
            onRefreshMe={onRefreshMe}
            onCredentialsChange={(credentials) => {
              if (!profile) return
              onMeChange({ ...state.me, profile: { ...profile, credentials } })
            }}
          />
        </TabsContent>
        <TabsContent value="spaces">
          <ProfessionalMemberships memberships={state.me.memberships} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ProfileShell({ children, onSpaces }: { children: React.ReactNode; onSpaces: () => void }) {
  return (
    <WorkspaceShell>
      <WorkspaceMain data-profile-canvas>
        <WorkspaceHeader data-profile-header>
          <ProductLockup
            product="studio"
            surface="light"
            title="Allfit Studio"
            width={169}
            height={40}
          />
          <WorkspaceActions>
            <Button variant="ghost" size="sm" onClick={onSpaces}>
              Mis espacios
            </Button>
            <form action={`${studioApi.apiUrl}/studio/v1/auth/logout`} method="post">
              <Button type="submit" variant="outline" size="sm">
                Cerrar sesión
              </Button>
            </form>
          </WorkspaceActions>
        </WorkspaceHeader>
        <WorkspaceContent data-profile-content>{children}</WorkspaceContent>
        <Toaster position="bottom-right" richColors closeButton />
      </WorkspaceMain>
    </WorkspaceShell>
  )
}
