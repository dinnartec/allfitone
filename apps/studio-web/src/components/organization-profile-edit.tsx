'use client'

/**
 * Editing what the organization is called and what kind of organization it is.
 *
 * Two things worth knowing before changing this screen.
 *
 * The type is not an ordinary field. PostgreSQL allows only the moves listed in
 * `organization_type_transitions`, and today every one of them starts at
 * `professional_practice`. A gym or a studio has nowhere to go, so for those the
 * type is rendered as a fact with the reason beside it rather than as a select
 * that can only refuse. See `lib/organization-profile.ts` for why the list of
 * moves lives in the client at all.
 *
 * Every save carries the revision the screen was showing, so a second person
 * editing the same organization is refused rather than silently overwritten.
 * That refusal is the fourth criterion of the story, and the message has to send
 * the person back to look: retrying with the same stale copy would erase the
 * other edit.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
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
import { type FormEvent, useId, useState } from 'react'

import { organizationTypeLabel } from './membership-selector'
import { useOrganizationContext } from './organization-context'
import { useStudioSessionMutation } from './studio-query-provider'
import {
  allowedTypeCodes,
  canManageOrganization,
  organizationChanges,
  organizationDraftErrors,
  organizationToDraft,
  typeIsFixed,
  type OrganizationDraft,
  type OrganizationTypeCode,
} from '@/lib/organization-profile'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type OrganizationUpdate,
} from '@/lib/studio-api'
import {
  isStudioQuerySessionCancelled,
  organizationQueryOptions,
  organizationRolesQueryOptions,
  studioQueryKeys,
} from '@/lib/studio-query'

export function OrganizationProfileEdit() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { current } = useOrganizationContext()
  const nameId = useId()
  const legalNameId = useId()
  const typeId = useId()
  const organizationPath = `/organizations/${current.organization_id}/organization`

  const organizationQuery = useQuery(organizationQueryOptions(current.organization_id))
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const organization = organizationQuery.data

  const [draft, setDraft] = useState<OrganizationDraft | null>(null)
  const [command, setCommand] = useState(newCommand)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)

  const updateMutation = useStudioSessionMutation({
    mutationFn: (
      {
        body,
        revision,
        command,
      }: { body: OrganizationUpdate; revision: number; command: CommandHeaders },
      signal,
    ) => studioApi.updateOrganization(current.organization_id, body, revision, command, signal),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organization(current.organization_id),
      })
    },
  })

  const saving = updateMutation.isPending

  if (organizationQuery.isPending || rolesQuery.isPending) return <LoadingState />

  if (!canManageOrganization(current.roles, rolesQuery.data?.items)) {
    return (
      <section data-organization-form-refusal>
        <Alert variant="warning" live="polite">
          <AlertTitle>Tu rol no administra la organización</AlertTitle>
          <AlertDescription>
            Puedes consultar estos datos en la sección Organización. Cambiarlos corresponde a quien
            la administra.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => router.replace(organizationPath)}>
          Ver los datos
        </Button>
      </section>
    )
  }

  // Absent, or in an organization this account cannot read: the read screen
  // makes the same refusal for the same reason, and so must this one.
  if (!organization) {
    return (
      <section data-organization-form-refusal>
        <Alert variant="warning" live="polite">
          <AlertTitle>No encontramos esta organización</AlertTitle>
          <AlertDescription>
            Puede que ya no exista o que tu vinculación haya terminado.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => router.replace(organizationPath)}>
          Volver
        </Button>
      </section>
    )
  }

  const editing = draft ?? organizationToDraft(organization)
  const fieldErrors = submitted ? organizationDraftErrors(editing) : {}
  const pending = organizationChanges(organization, editing)
  const fixedType = typeIsFixed(organization.type_code)
  const typeOptions = allowedTypeCodes(organization.type_code)

  function change(patch: Partial<OrganizationDraft>) {
    setDraft({ ...editing, ...patch })
    setCommand(newCommand())
    setError(undefined)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    // The refusal above already returned without this, but a hoisted function
    // does not carry that narrowing, and the revision below needs the row.
    if (!organization) return
    if (saving || Object.keys(organizationDraftErrors(editing)).length > 0) return
    if (!pending) return
    setError(undefined)
    try {
      await updateMutation.mutateAsync({
        body: pending,
        revision: organization.revision_number,
        command,
      })
      router.replace(organizationPath)
    } catch (caught) {
      if (isStudioQuerySessionCancelled(caught)) {
        setCommand(newCommand())
        return
      }
      setError(
        caught instanceof StudioApiError
          ? organizationEditError(caught)
          : ORGANIZATION_UNKNOWN_ERROR,
      )
    }
  }

  return (
    <SetupPanel>
      <SetupPanelIntro>
        <SetupPanelEyebrow>Organización</SetupPanelEyebrow>
        <SetupPanelTitle as="h2">Actualiza los datos.</SetupPanelTitle>
        <SetupPanelDescription>
          Así te identifica Allfit. Cambiarlos no toca roles, permisos ni relaciones con clientes.
        </SetupPanelDescription>
      </SetupPanelIntro>

      <SetupPanelContent>
        <form data-studio-form data-organization-profile-form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.displayName)}>
              <FieldLabel htmlFor={nameId}>Nombre</FieldLabel>
              <Input
                id={nameId}
                name="display_name"
                maxLength={120}
                value={editing.displayName}
                onChange={(event) => change({ displayName: event.target.value })}
                aria-invalid={Boolean(fieldErrors.displayName)}
                required
              />
              <FieldDescription>El nombre con el que te ven tus clientes.</FieldDescription>
              {fieldErrors.displayName ? <FieldError>{fieldErrors.displayName}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={legalNameId}>Razón social</FieldLabel>
              <Input
                id={legalNameId}
                name="legal_name"
                maxLength={160}
                value={editing.legalName}
                onChange={(event) => change({ legalName: event.target.value })}
              />
              <FieldDescription>
                Opcional. Déjala vacía para quitar la que estaba registrada.
              </FieldDescription>
            </Field>

            {fixedType ? (
              /* Nowhere to move to, so the control would exist only to refuse.
                 It is a fact now, not a field, and it is marked up as the one
                 the read screen already shows: a `label` pointing at a
                 paragraph is not a label, because a paragraph is not something
                 a label can name. The reason sits beside the value — without it
                 this reads as a field that broke rather than one that settled. */
              <div data-organization-type-fixed>
                <dl data-organization-facts>
                  <div data-organization-fact>
                    <dt>Tipo</dt>
                    <dd>{organizationTypeLabel(organization.type_code)}</dd>
                  </div>
                </dl>
                <p data-organization-type-note>
                  El tipo ya no se puede cambiar desde aquí. Escríbenos si tu organización cambió de
                  naturaleza.
                </p>
              </div>
            ) : (
              <Field>
                <FieldLabel htmlFor={typeId}>Tipo</FieldLabel>
                <Select
                  value={editing.typeCode}
                  onValueChange={(value) =>
                    change({ typeCode: (value ?? organization.type_code) as OrganizationTypeCode })
                  }
                  items={typeOptions.map((code) => ({
                    value: code,
                    label: organizationTypeLabel(code),
                  }))}
                >
                  <SelectTrigger id={typeId} data-studio-select-trigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {typeOptions.map((code) => (
                      <SelectItem key={code} value={code}>
                        {organizationTypeLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* The list offers only the moves the server accepts, and the
                    move is one way: saying so before the click is cheaper than
                    explaining it afterwards. */}
                <FieldDescription>
                  Pasar a gimnasio o estudio no tiene vuelta atrás desde esta pantalla.
                </FieldDescription>
              </Field>
            )}
          </FieldGroup>

          {error ? <FieldError data-organization-form-error>{error}</FieldError> : null}

          <SetupPanelActions>
            {/* Nothing to send is not an error, so the control says so by being
                unavailable rather than by refusing after the click. */}
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
  )
}

function LoadingState() {
  return (
    <p data-organization-form-loading role="status" aria-live="polite">
      Cargando los datos de la organización…
    </p>
  )
}

const ORGANIZATION_UNKNOWN_ERROR =
  'No pudimos guardar el cambio. Conservamos el intento para que puedas reintentar.'

/**
 * The 409 and the 422 are the two worth spelling out. The 409 means someone else
 * saved first, so retrying would overwrite their edit with a stale copy — the
 * only honest instruction is to look again. The 422 on this screen is almost
 * always the type: PostgreSQL refused a move its transition table does not list.
 */
function organizationEditError(error: StudioApiError): string {
  if (error.status === 409) {
    return 'Alguien más cambió estos datos mientras los editabas. Vuelve a abrir la pantalla para ver cómo quedaron.'
  }
  if (error.status === 403) return 'Tu rol ya no administra esta organización.'
  if (error.status === 404) return 'Esta organización ya no existe.'
  if (error.status === 422) {
    return 'Ese cambio de tipo no está permitido para tu organización. Revisa el nombre y vuelve a intentarlo.'
  }
  if (error.status === 428) {
    return 'Vuelve a abrir la pantalla para editarla con los datos actuales.'
  }
  if (error.status === 429) {
    return 'Ese cambio ya está en curso. Espera un momento y reintenta sin cambiar los datos.'
  }
  if (error.status === 503) {
    return 'La edición de la organización está pausada temporalmente. Reintenta más tarde.'
  }
  return ORGANIZATION_UNKNOWN_ERROR
}
