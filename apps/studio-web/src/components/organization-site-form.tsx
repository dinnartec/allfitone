'use client'

/**
 * Registering a site: a name, and optionally where it is.
 *
 * Nothing more belongs here. A site is location information — it carries no
 * capacity, no bookable resources, no classes and no inventory, and it does not
 * scope permissions: there is no per-site role in V1. Every one of those is a
 * separate decision the product has not taken.
 *
 * Permission comes from the role catalog the server publishes, not from a list
 * of role codes kept here. PostgreSQL grants this through the `manage_sites`
 * capability, and a second copy of that mapping would drift the day it changes.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import {
  SetupPanel,
  SetupPanelActions,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { useStudioSessionMutation } from './studio-query-provider'
import {
  canManageSites,
  siteDraftErrors,
  siteDraftToRequest,
  type SiteDraft,
} from '@/lib/organization-sites'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type OrganizationSiteCreate,
} from '@/lib/studio-api'
import {
  isStudioQuerySessionCancelled,
  organizationRolesQueryOptions,
  studioQueryKeys,
} from '@/lib/studio-query'

export function OrganizationSiteForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { current } = useOrganizationContext()
  const organizationPath = `/organizations/${current.organization_id}/organization`
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const [draft, setDraft] = useState<SiteDraft>({ name: '', address: '' })
  const [command, setCommand] = useState(newCommand)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)

  const createMutation = useStudioSessionMutation({
    mutationFn: (
      { body, command }: { body: OrganizationSiteCreate; command: CommandHeaders },
      signal,
    ) => studioApi.createOrganizationSite(current.organization_id, body, command, signal),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organization(current.organization_id),
      })
    },
  })

  const submitting = createMutation.isPending
  const fieldErrors = submitted ? siteDraftErrors(draft) : {}
  const allowed = canManageSites(current.roles, rolesQuery.data?.items)

  // The catalog is the server's answer on who may do this. Until it arrives
  // there is nothing honest to render: a form would be a promise, and a refusal
  // would be a guess.
  if (rolesQuery.isPending) return null

  if (!allowed) {
    return (
      <section data-site-form-refusal>
        <Alert variant="warning" live="polite">
          <AlertTitle>Tu rol no administra las sedes</AlertTitle>
          <AlertDescription>
            Puedes consultarlas en la sección Organización. Registrar una sede corresponde a quien
            administra la organización.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => router.replace(organizationPath)}>
          Ver las sedes
        </Button>
      </section>
    )
  }

  function change(patch: Partial<SiteDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }))
    // A different site is a different command: reusing the key would replay the
    // first one and register the same site twice under two names.
    setCommand(newCommand())
    setError(undefined)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (submitting || Object.keys(siteDraftErrors(draft)).length > 0) return
    setError(undefined)
    try {
      await createMutation.mutateAsync({ body: siteDraftToRequest(draft), command })
      router.replace(organizationPath)
    } catch (caught) {
      if (isStudioQuerySessionCancelled(caught)) {
        setCommand(newCommand())
        return
      }
      setError(caught instanceof StudioApiError ? siteError(caught) : SITE_UNKNOWN_ERROR)
    }
  }

  return (
    <SetupPanel>
      <SetupPanelIntro>
        <SetupPanelEyebrow>Organización</SetupPanelEyebrow>
        <SetupPanelTitle as="h2">Registra una sede.</SetupPanelTitle>
        <SetupPanelDescription>
          Una sede ubica dónde opera tu organización. No define aforo, horarios ni permisos: los
          roles funcionan igual en todas.
        </SetupPanelDescription>
      </SetupPanelIntro>

      <SetupPanelContent>
        <form data-studio-form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.name)}>
              <FieldLabel htmlFor="site-name">Nombre</FieldLabel>
              <Input
                id="site-name"
                name="name"
                maxLength={120}
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                aria-invalid={Boolean(fieldErrors.name)}
                required
              />
              <FieldDescription>
                Como la reconoce tu equipo, por ejemplo Sede Norte.
              </FieldDescription>
              {fieldErrors.name ? <FieldError>{fieldErrors.name}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="site-address">Dirección</FieldLabel>
              <Input
                id="site-address"
                name="address"
                maxLength={240}
                value={draft.address}
                onChange={(event) => change({ address: event.target.value })}
              />
              <FieldDescription>Opcional. Puedes agregarla más adelante.</FieldDescription>
            </Field>
          </FieldGroup>

          {error ? <FieldError data-site-form-error>{error}</FieldError> : null}

          <SetupPanelActions>
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? 'Registrando…' : 'Registrar sede'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => router.replace(organizationPath)}
            >
              Cancelar
            </Button>
          </SetupPanelActions>
        </form>
      </SetupPanelContent>
    </SetupPanel>
  )
}

const SITE_UNKNOWN_ERROR =
  'No pudimos registrar la sede. Conservamos el intento para que puedas reintentar.'

/**
 * One message per answer the API actually gives. The 409 and the 429 both mean
 * "this same command is already running", so neither invites a second attempt
 * with different data — reintentar sin cambiar nada is what resolves them.
 */
function siteError(error: StudioApiError): string {
  if (error.status === 403) return 'Tu rol ya no administra las sedes de esta organización.'
  if (error.status === 404) return 'Ya no tienes acceso activo a esta organización.'
  if (error.status === 422) return 'Revisa el nombre de la sede.'
  if (error.status === 409 || error.status === 429) {
    return 'Ese registro ya está en curso. Espera un momento y reintenta sin cambiar los datos.'
  }
  if (error.status === 503) {
    return 'El registro de sedes está pausado temporalmente. Reintenta más tarde.'
  }
  return SITE_UNKNOWN_ERROR
}
