'use client'

/**
 * Editing a site, and taking it out of service.
 *
 * Two things that look alike and are not, so they are separate controls. The
 * form changes what a site is called and where it is; withdrawing it changes
 * whether the organization operates from there. Putting a status toggle beside
 * the name would let someone withdraw a site while fixing a typo.
 *
 * Every save carries the revision the screen was showing, so a second person
 * editing the same site is refused rather than silently overwritten.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@allfitone/react/components/alert-dialog'
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
import { Spinner } from '@allfitone/react/components/spinner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { useStudioSessionMutation } from './studio-query-provider'
import {
  canManageSites,
  siteChanges,
  siteDraftErrors,
  siteToDraft,
  type SiteDraft,
} from '@/lib/organization-sites'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type OrganizationSiteUpdate,
} from '@/lib/studio-api'
import {
  isStudioQuerySessionCancelled,
  organizationQueryOptions,
  organizationRolesQueryOptions,
  studioQueryKeys,
} from '@/lib/studio-query'

export function OrganizationSiteEdit() {
  const router = useRouter()
  const params = useParams<{ siteId: string }>()
  const queryClient = useQueryClient()
  const { current } = useOrganizationContext()
  const organizationPath = `/organizations/${current.organization_id}/organization`

  const organizationQuery = useQuery(organizationQueryOptions(current.organization_id))
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const site = organizationQuery.data?.sites.find((entry) => entry.id === params.siteId)

  const [draft, setDraft] = useState<SiteDraft | null>(null)
  const [command, setCommand] = useState(newCommand)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false)

  const updateMutation = useStudioSessionMutation({
    mutationFn: (
      {
        siteId,
        body,
        revision,
        command,
      }: {
        siteId: string
        body: OrganizationSiteUpdate
        revision: number
        command: CommandHeaders
      },
      signal,
    ) =>
      studioApi.updateOrganizationSite(
        current.organization_id,
        siteId,
        body,
        revision,
        command,
        signal,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organization(current.organization_id),
      })
    },
  })

  const saving = updateMutation.isPending
  const allowed = canManageSites(current.roles, rolesQuery.data?.items)

  if (organizationQuery.isPending || rolesQuery.isPending) return null

  if (!allowed) {
    return (
      <section data-site-form-refusal>
        <Alert variant="warning" live="polite">
          <AlertTitle>Tu rol no administra las sedes</AlertTitle>
          <AlertDescription>
            Puedes consultarlas en la sección Organización. Editarlas corresponde a quien administra
            la organización.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => router.replace(organizationPath)}>
          Ver las sedes
        </Button>
      </section>
    )
  }

  // Absent from the organization it belongs to, which is the only place this
  // screen can find it: the same answer for a site that never existed and one
  // in an organization this account cannot read.
  if (!site) {
    return (
      <section data-site-form-refusal>
        <Alert variant="warning" live="polite">
          <AlertTitle>No encontramos esta sede</AlertTitle>
          <AlertDescription>
            Puede que se haya eliminado o que el enlace ya no sea válido.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => router.replace(organizationPath)}>
          Ver las sedes
        </Button>
      </section>
    )
  }

  const editing = draft ?? siteToDraft(site)
  const fieldErrors = submitted ? siteDraftErrors(editing) : {}
  const pending = siteChanges(site, editing)

  function change(patch: Partial<SiteDraft>) {
    setDraft({ ...editing, ...patch })
    setCommand(newCommand())
    setError(undefined)
  }

  async function save(body: OrganizationSiteUpdate, onDone: () => void) {
    if (!site) return
    setError(undefined)
    try {
      await updateMutation.mutateAsync({
        siteId: site.id,
        body,
        revision: site.revision_number,
        command,
      })
      onDone()
    } catch (caught) {
      if (isStudioQuerySessionCancelled(caught)) {
        setCommand(newCommand())
        return
      }
      setError(caught instanceof StudioApiError ? siteEditError(caught) : SITE_UNKNOWN_ERROR)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (saving || Object.keys(siteDraftErrors(editing)).length > 0) return
    if (!pending) return
    await save(pending, () => router.replace(organizationPath))
  }

  const withdrawing = site.status === 'active'

  return (
    <>
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Organización</SetupPanelEyebrow>
          <SetupPanelTitle as="h2">Edita esta sede.</SetupPanelTitle>
          <SetupPanelDescription>
            Cambia cómo se llama o dónde está. Quitarla de servicio es una acción aparte, más abajo.
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
                  value={editing.name}
                  onChange={(event) => change({ name: event.target.value })}
                  aria-invalid={Boolean(fieldErrors.name)}
                  required
                />
                {fieldErrors.name ? <FieldError>{fieldErrors.name}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="site-address">Dirección</FieldLabel>
                <Input
                  id="site-address"
                  name="address"
                  maxLength={240}
                  value={editing.address}
                  onChange={(event) => change({ address: event.target.value })}
                />
                <FieldDescription>
                  Opcional. Déjala vacía para quitar la que estaba registrada.
                </FieldDescription>
              </Field>
            </FieldGroup>

            {error ? <FieldError data-site-form-error>{error}</FieldError> : null}

            <SetupPanelActions>
              {/* Nothing to send is not an error, so the control says so by
                  being unavailable rather than by refusing after the click. */}
              <Button type="submit" size="lg" disabled={saving || !pending}>
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => router.replace(organizationPath)}
              >
                Cancelar
              </Button>
            </SetupPanelActions>
          </form>
        </SetupPanelContent>
      </SetupPanel>

      <section data-site-status-panel aria-labelledby="site-status-title">
        <h2 id="site-status-title" data-site-status-title>
          {withdrawing ? 'Retirar de servicio' : 'Volver a poner en servicio'}
        </h2>
        <p data-site-status-description>
          {withdrawing
            ? 'La sede deja de aparecer como activa y sigue en la lista, con su historial intacto.'
            : 'La sede vuelve a contar como activa en tu organización.'}
        </p>
        <Button
          variant={withdrawing ? 'outline' : 'default'}
          disabled={saving}
          onClick={() => setConfirmingWithdrawal(true)}
        >
          {withdrawing ? 'Retirar de servicio' : 'Poner en servicio'}
        </Button>
      </section>

      <AlertDialog
        open={confirmingWithdrawal}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setConfirmingWithdrawal(false)
            setError(undefined)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {withdrawing
                ? `¿Retirar ${site.name} de servicio?`
                : `¿Poner ${site.name} en servicio?`}
            </AlertDialogTitle>
            {/* The first criterion of the story, said to the person about to
                act on it: this is what withdrawing does not touch. */}
            <AlertDialogDescription>
              {withdrawing
                ? 'No cambia relaciones, asignaciones ni historial. La sede sigue en la lista como inactiva y puedes volver a activarla cuando quieras.'
                : 'Volverá a contar entre las sedes activas de tu organización.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <Alert variant="danger" live="assertive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Conservar como está</AlertDialogCancel>
            <AlertDialogAction
              variant={withdrawing ? 'destructive' : 'default'}
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                void save({ status: withdrawing ? 'inactive' : 'active' }, () => {
                  setConfirmingWithdrawal(false)
                  router.replace(organizationPath)
                })
              }}
            >
              {saving ? <Spinner label="Guardando el cambio" /> : null}
              {withdrawing ? 'Retirar de servicio' : 'Poner en servicio'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

const SITE_UNKNOWN_ERROR =
  'No pudimos guardar el cambio. Conservamos el intento para que puedas reintentar.'

/**
 * The 409 is the one worth spelling out: it means someone else saved this same
 * site first, so retrying would overwrite their edit with a stale copy. The
 * only honest instruction is to look again.
 */
function siteEditError(error: StudioApiError): string {
  if (error.status === 409) {
    return 'Alguien más cambió esta sede mientras la editabas. Vuelve a abrirla para ver cómo quedó.'
  }
  if (error.status === 403) return 'Tu rol ya no administra las sedes de esta organización.'
  if (error.status === 404) return 'Esta sede ya no existe.'
  if (error.status === 422) return 'Revisa el nombre de la sede.'
  if (error.status === 428) return 'Vuelve a abrir la sede para editarla con los datos actuales.'
  if (error.status === 429) {
    return 'Ese cambio ya está en curso. Espera un momento y reintenta sin cambiar los datos.'
  }
  if (error.status === 503) {
    return 'La edición de sedes está pausada temporalmente. Reintenta más tarde.'
  }
  return SITE_UNKNOWN_ERROR
}
