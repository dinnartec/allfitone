'use client'

import { ProductWordmark } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Spinner } from '@allfitone/react/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allfitone/react/components/tabs'
import { Toaster } from '@allfitone/react/components/sonner'
import {
  WorkspaceActions,
  WorkspaceContent,
  WorkspaceEyebrow,
  WorkspaceHeader,
  WorkspaceMain,
  WorkspaceShell,
  WorkspaceTitle,
} from '@allfitone/react/components/workspace-shell'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { LogoutForm } from './logout-form'
import { ProfessionalCredentials } from './professional-credentials'
import { ProfessionalMemberships } from './professional-memberships'
import { ProfessionalPresentation } from './professional-presentation'
import {
  StudioApiError,
  studioApi,
  type ProfessionalCatalogItem,
  type StudioMe,
} from '@/lib/studio-api'

type AccountState =
  { kind: 'loading' } | { kind: 'ready'; me: StudioMe } | { kind: 'error'; retryable: boolean }

type CatalogState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready'
      specialties: ProfessionalCatalogItem[]
      credentialTypes: ProfessionalCatalogItem[]
    }
  | { kind: 'error'; retryable: boolean }

export function ProfessionalProfileScreen() {
  const router = useRouter()
  const [state, setState] = useState<AccountState>({ kind: 'loading' })
  const [catalogs, setCatalogs] = useState<CatalogState>({ kind: 'idle' })
  const [setupStarted, setSetupStarted] = useState(false)

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

  const loadAccount = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      setState({ kind: 'ready', me: await studioApi.me() })
    } catch (error) {
      if (routeSessionFailure(error)) return
      setState({
        kind: 'error',
        retryable: error instanceof StudioApiError && error.status === 503,
      })
    }
  }, [routeSessionFailure])

  const loadProfessionalCatalogs = useCallback(async () => {
    setCatalogs({ kind: 'loading' })
    try {
      const [specialtyList, credentialTypeList] = await Promise.all([
        studioApi.professionalSpecialties(),
        studioApi.professionalCredentialTypes(),
      ])
      setCatalogs({
        kind: 'ready',
        specialties: specialtyList.items,
        credentialTypes: credentialTypeList.items,
      })
    } catch (error) {
      if (routeSessionFailure(error)) return
      setCatalogs({
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
    void loadAccount()
  }, [loadAccount])

  useEffect(() => {
    if (state.kind === 'ready' && state.me.profile && catalogs.kind === 'idle') {
      void loadProfessionalCatalogs()
    }
  }, [catalogs.kind, loadProfessionalCatalogs, state])

  return (
    <AccountShell onSpaces={() => router.push('/')}>
      {state.kind === 'loading' ? (
        <div data-profile-state role="status" aria-live="polite">
          <Spinner label="Cargando tu cuenta" />
          <p>Reuniendo tus espacios y opciones personales…</p>
        </div>
      ) : state.kind === 'error' ? (
        <div data-profile-state>
          <Alert variant="danger" live="assertive">
            <AlertTitle>No pudimos abrir tu cuenta</AlertTitle>
            <AlertDescription>
              {state.retryable
                ? 'El servicio no está disponible en este momento. Puedes reintentar.'
                : 'Ocurrió un error al reunir la información de tu cuenta.'}
            </AlertDescription>
            <Button onClick={() => void loadAccount()}>Reintentar</Button>
          </Alert>
        </div>
      ) : !state.me.profile && !setupStarted ? (
        <AccountOverview
          me={state.me}
          onStartProfessionalSetup={() => {
            setSetupStarted(true)
            if (catalogs.kind === 'idle' || catalogs.kind === 'error') {
              void loadProfessionalCatalogs()
            }
          }}
        />
      ) : catalogs.kind === 'ready' ? (
        <ProfessionalArea
          me={state.me}
          specialties={catalogs.specialties}
          credentialTypes={catalogs.credentialTypes}
          setupStarted={setupStarted}
          onCancelSetup={() => setSetupStarted(false)}
          onSessionFailure={routeSessionFailure}
          onRefreshMe={refreshMe}
          onMeChange={(me) =>
            setState((current) => (current.kind === 'ready' ? { ...current, me } : current))
          }
        />
      ) : catalogs.kind === 'error' ? (
        <ProfessionalCatalogError
          retryable={catalogs.retryable}
          onRetry={() => void loadProfessionalCatalogs()}
          onBack={!state.me.profile ? () => setSetupStarted(false) : undefined}
        />
      ) : (
        <div data-profile-state role="status" aria-live="polite">
          <Spinner label="Preparando la configuración profesional" />
          <p>Reuniendo especialidades y tipos de credencial…</p>
        </div>
      )}
    </AccountShell>
  )
}

function AccountOverview({
  me,
  onStartProfessionalSetup,
}: {
  me: StudioMe
  onStartProfessionalSetup: () => void
}) {
  const activeSpaces = me.memberships.filter((membership) => membership.status === 'active').length
  return (
    <>
      <header data-profile-heading>
        <div data-profile-heading-text>
          <WorkspaceEyebrow>Mi cuenta</WorkspaceEyebrow>
          <WorkspaceTitle>Tu cuenta de Studio</WorkspaceTitle>
          <p data-page-header-description>
            Administra tus espacios. Si también entrenas o prestas servicios, puedes crear un perfil
            profesional separado cuando lo necesites.
          </p>
        </div>
        <Badge variant="success">Cuenta activa</Badge>
      </header>

      <section data-account-map aria-label="Opciones de mi cuenta">
        <Card data-account-track>
          <CardHeader>
            <CardDescription>Siempre disponible</CardDescription>
            <CardTitle role="heading" aria-level={2}>
              Mis espacios
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                {activeSpaces} {activeSpaces === 1 ? 'activo' : 'activos'}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent data-account-body>
            <p>Consulta las organizaciones donde participas y tu historial de vinculaciones.</p>
          </CardContent>
          <CardFooter>
            <Badge variant="success">Activo</Badge>
          </CardFooter>
        </Card>

        <Card data-account-track>
          <CardHeader>
            <CardDescription>Solo si prestas servicios</CardDescription>
            <CardTitle role="heading" aria-level={2}>
              Perfil profesional
            </CardTitle>
            <CardAction>
              <Badge variant="outline">Opcional</Badge>
            </CardAction>
          </CardHeader>
          <CardContent data-account-body>
            <p>
              Presenta tu experiencia y, si quieres, declara credenciales. Administrar un espacio no
              requiere completar esta información.
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={onStartProfessionalSetup}>Configurar perfil profesional</Button>
          </CardFooter>
        </Card>
      </section>

      <ProfessionalMemberships memberships={me.memberships} />
    </>
  )
}

function ProfessionalArea({
  me,
  specialties,
  credentialTypes,
  setupStarted,
  onCancelSetup,
  onSessionFailure,
  onRefreshMe,
  onMeChange,
}: {
  me: StudioMe
  specialties: ProfessionalCatalogItem[]
  credentialTypes: ProfessionalCatalogItem[]
  setupStarted: boolean
  onCancelSetup: () => void
  onSessionFailure: (error: unknown) => boolean
  onRefreshMe: () => Promise<StudioMe | undefined>
  onMeChange: (me: StudioMe) => void
}) {
  const profile = me.profile

  if (!profile && setupStarted) {
    return (
      <>
        <header data-profile-heading>
          <div data-profile-heading-text>
            <WorkspaceEyebrow>Opcional · Personal</WorkspaceEyebrow>
            <WorkspaceTitle>Configura tu perfil profesional</WorkspaceTitle>
            <p data-page-header-description>
              Hazlo únicamente si entrenas o prestas servicios. Este perfil es tuyo y no cambia
              roles, permisos ni membresías.
            </p>
          </div>
          <Badge variant="outline">Sin publicar</Badge>
        </header>
        <div data-profile-setup-actions>
          <Button variant="ghost" onClick={onCancelSetup}>
            Volver a mi cuenta
          </Button>
        </div>
        <ProfessionalPresentation
          profile={null}
          specialties={specialties}
          onSessionFailure={onSessionFailure}
          onSaved={(savedProfile) => onMeChange({ ...me, profile: savedProfile })}
        />
      </>
    )
  }

  if (!profile) return null

  return (
    <>
      <header data-profile-heading>
        <div data-profile-heading-text>
          <WorkspaceEyebrow>Perfil profesional</WorkspaceEyebrow>
          <WorkspaceTitle>{profile.headline}</WorkspaceTitle>
          <p data-page-header-description>
            Tu presentación personal viaja contigo entre espacios. Sus credenciales son opcionales y
            nunca cambian tus permisos.
          </p>
        </div>
        <Badge variant="success">Perfil creado</Badge>
      </header>

      <Tabs defaultValue="presentation" data-profile-tabs>
        <TabsList variant="line" aria-label="Secciones de mi cuenta">
          <TabsTrigger value="presentation">Presentación</TabsTrigger>
          <TabsTrigger value="credentials">Credenciales opcionales</TabsTrigger>
          <TabsTrigger value="spaces">Mis espacios</TabsTrigger>
        </TabsList>
        <TabsContent value="presentation">
          <ProfessionalPresentation
            profile={profile}
            specialties={specialties}
            onSessionFailure={onSessionFailure}
            onSaved={(savedProfile) => onMeChange({ ...me, profile: savedProfile })}
          />
        </TabsContent>
        <TabsContent value="credentials">
          <ProfessionalCredentials
            credentials={profile.credentials}
            credentialTypes={credentialTypes}
            profileExists
            onSessionFailure={onSessionFailure}
            onRefreshMe={onRefreshMe}
            onCredentialsChange={(credentials) =>
              onMeChange({ ...me, profile: { ...profile, credentials } })
            }
          />
        </TabsContent>
        <TabsContent value="spaces">
          <ProfessionalMemberships memberships={me.memberships} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ProfessionalCatalogError({
  retryable,
  onRetry,
  onBack,
}: {
  retryable: boolean
  onRetry: () => void
  onBack?: (() => void) | undefined
}) {
  return (
    <div data-profile-state>
      <Alert variant="danger" live="assertive">
        <AlertTitle>No pudimos preparar el perfil profesional</AlertTitle>
        <AlertDescription>
          {retryable
            ? 'Los catálogos profesionales no están disponibles en este momento.'
            : 'Ocurrió un error al reunir los catálogos profesionales.'}
        </AlertDescription>
        <Button onClick={onRetry}>Reintentar</Button>
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            Volver a mi cuenta
          </Button>
        ) : null}
      </Alert>
    </div>
  )
}

function AccountShell({ children, onSpaces }: { children: React.ReactNode; onSpaces: () => void }) {
  return (
    <WorkspaceShell>
      <WorkspaceMain data-profile-canvas>
        <WorkspaceHeader data-profile-header>
          <ProductWordmark
            product="studio"
            surface="light"
            title="Allfit Studio"
            width={138}
            height={28}
          />
          <WorkspaceActions>
            <Button variant="ghost" size="sm" onClick={onSpaces}>
              Mis espacios
            </Button>
            <LogoutForm variant="outline" />
          </WorkspaceActions>
        </WorkspaceHeader>
        <WorkspaceContent data-profile-content>{children}</WorkspaceContent>
        <Toaster position="bottom-right" richColors closeButton />
      </WorkspaceMain>
    </WorkspaceShell>
  )
}
