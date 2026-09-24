'use client'

import { BrandLogoCarrier, ProductWordmark } from '@allfitone/react/brand'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { LogoutForm } from './logout-form'
import { ProfessionalCredentials } from './professional-credentials'
import { ProfessionalMemberships } from './professional-memberships'
import { ProfessionalPresentation } from './professional-presentation'
import { LoadingCard } from './studio-frame'
import { StudioApiError, type ProfessionalCatalogItem, type StudioMe } from '@/lib/studio-api'
import { useCompactViewport } from '@/lib/use-compact-viewport'
import {
  professionalCredentialTypesQueryOptions,
  professionalSpecialtiesQueryOptions,
  studioMeQueryOptions,
  studioQueryKeys,
} from '@/lib/studio-query'

export function ProfessionalProfileScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
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

  const meQuery = useQuery(studioMeQueryOptions())
  const catalogsEnabled = Boolean(meQuery.data?.profile || setupStarted)
  const specialtiesQuery = useQuery({
    ...professionalSpecialtiesQueryOptions(),
    enabled: catalogsEnabled,
  })
  const credentialTypesQuery = useQuery({
    ...professionalCredentialTypesQueryOptions(),
    enabled: catalogsEnabled,
  })
  const catalogError = specialtiesQuery.error ?? credentialTypesQuery.error
  const catalogsReady = specialtiesQuery.data && credentialTypesQuery.data

  useEffect(() => {
    const error = meQuery.error ?? catalogError
    if (error) routeSessionFailure(error)
  }, [catalogError, meQuery.error, routeSessionFailure])

  const refreshMe = useCallback(async (): Promise<StudioMe | undefined> => {
    await queryClient.invalidateQueries({ queryKey: studioQueryKeys.me(), exact: true })
    try {
      return await queryClient.fetchQuery({ ...studioMeQueryOptions(), staleTime: 0 })
    } catch (error) {
      if (!routeSessionFailure(error)) throw error
      return undefined
    }
  }, [queryClient, routeSessionFailure])

  function retryCatalogs(): void {
    void specialtiesQuery.refetch()
    void credentialTypesQuery.refetch()
  }

  return (
    <AccountShell onSpaces={() => router.push('/')}>
      {/* A refresh of what is already on screen, never a first load. Gated on
          `catalogsEnabled` it also fired while the catalogues loaded for the first
          time, so "Actualizando tu cuenta…" sat above the catalogue loader. */}
      {(meQuery.isFetching && !meQuery.isPending) ||
      (catalogsReady && (specialtiesQuery.isFetching || credentialTypesQuery.isFetching)) ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando tu cuenta…
        </p>
      ) : null}
      {meQuery.isError && meQuery.data ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No pudimos actualizar tu cuenta</AlertTitle>
          <AlertDescription>La información cargada permanece visible.</AlertDescription>
          <AlertAction>
            <Button onClick={() => void meQuery.refetch()}>Reintentar</Button>
          </AlertAction>
        </Alert>
      ) : null}
      {catalogError && catalogsReady ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No pudimos actualizar los catálogos profesionales</AlertTitle>
          <AlertDescription>Los datos cargados permanecen disponibles.</AlertDescription>
          <AlertAction>
            <Button onClick={retryCatalogs}>Reintentar</Button>
          </AlertAction>
        </Alert>
      ) : null}
      {/* The same card as every other wait in Studio. Composed here by hand, a
          lone spinner and a paragraph sat against the page's left edge, and the
          spinner's open arc read as a letter C. */}
      {meQuery.isPending ? (
        <LoadingCard label="Reuniendo tus espacios y opciones personales…" />
      ) : !meQuery.data ? (
        <div data-profile-state>
          <Alert variant="danger" live="assertive">
            <AlertTitle role="heading" aria-level={1}>
              No pudimos abrir tu cuenta
            </AlertTitle>
            <AlertDescription>
              {meQuery.error instanceof StudioApiError && meQuery.error.status === 503
                ? 'El servicio no está disponible en este momento. Puedes reintentar.'
                : 'Ocurrió un error al reunir la información de tu cuenta.'}
            </AlertDescription>
            <AlertAction>
              <Button onClick={() => void meQuery.refetch()}>Reintentar</Button>
            </AlertAction>
          </Alert>
        </div>
      ) : !meQuery.data.profile && !setupStarted ? (
        <AccountOverview
          me={meQuery.data}
          onStartProfessionalSetup={() => {
            setSetupStarted(true)
          }}
        />
      ) : catalogsReady ? (
        <ProfessionalArea
          me={meQuery.data}
          specialties={specialtiesQuery.data.items}
          credentialTypes={credentialTypesQuery.data.items}
          setupStarted={setupStarted}
          onCancelSetup={() => setSetupStarted(false)}
          onSessionFailure={routeSessionFailure}
          onRefreshMe={refreshMe}
          onMeChange={(me) => queryClient.setQueryData(studioQueryKeys.me(), me)}
        />
      ) : catalogError ? (
        <ProfessionalCatalogError
          retryable={catalogError instanceof StudioApiError && catalogError.status === 503}
          onRetry={retryCatalogs}
          onBack={!meQuery.data.profile ? () => setSetupStarted(false) : undefined}
        />
      ) : (
        <LoadingCard label="Reuniendo especialidades y tipos de credencial…" />
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

      {/* There used to be a "Mis espacios" card here, signposting the section
          two hundred pixels below it on the same screen. It repeated that
          section's own heading, so the page offered the same h2 twice and a
          heading list read as two destinations for one. */}
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
          <div data-card-footer-actions>
            <Button onClick={onStartProfessionalSetup}>Configurar perfil profesional</Button>
          </div>
        </CardFooter>
      </Card>

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
          {/* No badge here. "Sin publicar" named a state the product does not
              have — `ProfessionalProfile` carries no published, draft or
              visibility field — and implied that saving would make the profile
              public, which nothing does. Its counterpart on the created screen
              says "Perfil creado", so it was not even the same vocabulary. */}
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
          {/* One word, like its two siblings. "Credenciales opcionales" was
              193px of a 358px strip and pushed "Mis espacios" behind a scroll;
              the panel itself opens by saying they are not required. */}
          <TabsTrigger value="credentials">Credenciales</TabsTrigger>
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
        <AlertTitle role="heading" aria-level={1}>
          No pudimos preparar el perfil profesional
        </AlertTitle>
        <AlertDescription>
          {retryable
            ? 'Los catálogos profesionales no están disponibles en este momento.'
            : 'Ocurrió un error al reunir los catálogos profesionales.'}
        </AlertDescription>
        <AlertAction>
          <Button onClick={onRetry}>Reintentar</Button>
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              Volver a mi cuenta
            </Button>
          ) : null}
        </AlertAction>
      </Alert>
    </div>
  )
}

function AccountShell({ children, onSpaces }: { children: React.ReactNode; onSpaces: () => void }) {
  const compact = useCompactViewport()
  return (
    <WorkspaceShell>
      <WorkspaceMain data-profile-canvas>
        <WorkspaceHeader data-profile-header>
          {/* `WorkspaceActions` is `shrink-0`, so the brand absorbs every bit of
              squeeze: the 138px wordmark rendered at 14px on a 320px phone. The
              compact mark fits beside both labelled controls from 360px up
              (27+125+137+gaps = 309 of 328), and below that the CSS hides it —
              the brand is shown whole or not at all, never crushed. */}
          <span data-profile-brand>
            {compact ? (
              <BrandLogoCarrier title="Allfit Studio" height={28} />
            ) : (
              <ProductWordmark
                product="studio"
                surface="light"
                title="Allfit Studio"
                width={138}
                height={28}
              />
            )}
          </span>
          <WorkspaceActions>
            <Button variant="ghost" size="sm" onClick={onSpaces}>
              Mis espacios
            </Button>
            <LogoutForm variant="outline" />
          </WorkspaceActions>
        </WorkspaceHeader>
        <WorkspaceContent data-profile-content>{children}</WorkspaceContent>
        {/* No `richColors`: it swaps the Design System's tokens for the toast
            library's own palette, whose green reads 4.25:1 and misses AA. The
            type still arrives through the icon. */}
        <Toaster position="bottom-right" closeButton />
      </WorkspaceMain>
    </WorkspaceShell>
  )
}
