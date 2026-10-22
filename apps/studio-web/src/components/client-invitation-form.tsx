'use client'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import { Badge } from '@allfitone/react/components/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Checkbox } from '@allfitone/react/components/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { useStudioSessionMutation } from './studio-query-provider'
import { WorkspacePageHeader } from './workspace-page-header'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type ClientInvitation,
  type ClientInvitationCreate,
  type CommandHeaders,
} from '@/lib/studio-api'
import {
  isStudioQuerySessionCancelled,
  offerableScopesQueryOptions,
  organizationClientsQueryOptions,
  organizationRolesQueryOptions,
  studioQueryKeys,
} from '@/lib/studio-query'
import {
  canInviteClients,
  invitationBody,
  toggleScope,
  validateDraft,
  type InvitationDraftErrors,
} from '@/lib/client-invitations'
import {
  QUOTA_FULL_MESSAGE,
  QUOTA_RULE_NOTE,
  guestQuotaOf,
  invitationBlockedReason,
  quotaSummary,
} from '@/lib/guest-quota'

export function ClientInvitationForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { current } = useOrganizationContext()
  const rolesQuery = useQuery(organizationRolesQueryOptions(current.organization_id))
  const scopesQuery = useQuery(offerableScopesQueryOptions())
  // The same read as the directory, so the figure is the one the directory shows.
  const quotaQuery = useInfiniteQuery(
    organizationClientsQueryOptions(current.organization_id, 'all', 50),
  )
  const quota = guestQuotaOf(quotaQuery.data)
  const blockedReason = invitationBlockedReason(quota)
  const allowed = canInviteClients(current.roles, rolesQuery.data?.items)
  const directoryPath = `/organizations/${current.organization_id}/clients`

  const [contact, setContact] = useState('')
  const [scopeCodes, setScopeCodes] = useState<string[]>([])
  const [command, setCommand] = useState(newCommand)
  const [errors, setErrors] = useState<InvitationDraftErrors>({})
  const [failure, setFailure] = useState<string>()
  const [sent, setSent] = useState<ClientInvitation>()

  const catalog = scopesQuery.data?.items ?? []
  const createMutation = useStudioSessionMutation({
    mutationFn: (input: { body: ClientInvitationCreate; command: CommandHeaders }) =>
      studioApi.createClientInvitation(current.organization_id, input.body, input.command),
  })
  const submitting = createMutation.isPending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || blockedReason) return
    const draft = { contact, scopeCodes }
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setFailure(undefined)
    try {
      const invitation = await createMutation.mutateAsync({
        body: invitationBody(draft, catalog),
        command,
      })
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organizationClientsRoot(current.organization_id),
      })
      setSent(invitation)
    } catch (caught) {
      if (isStudioQuerySessionCancelled(caught)) {
        // The session was recovered mid-flight. A fresh command, so the retry
        // is a new invitation rather than a replay of one that never landed.
        setCommand(newCommand())
        return
      }
      if (caught instanceof StudioApiError && caught.code === 'guest-quota-full') {
        // The figure on screen was stale: read it again so the form explains itself.
        await queryClient.invalidateQueries({
          queryKey: studioQueryKeys.organizationClientsRoot(current.organization_id),
        })
      }
      setFailure(caught instanceof StudioApiError ? invitationError(caught) : GENERIC_FAILURE)
    }
  }

  if (!rolesQuery.isPending && !allowed) {
    // A plain section with an alert, as the directory does for the same case.
    // `SetupPanel` is two columns and would leave half the screen empty.
    return (
      <section data-client-invite-page aria-label="Invitar a una persona">
        <WorkspacePageHeader description="Invitar clientes está disponible para quienes atienden personas o administran la organización." />
        <Alert variant="warning">
          <AlertTitle>No puedes invitar clientes</AlertTitle>
          <AlertDescription>
            Tu rol en {current.display_name} no permite enviar invitaciones a clientes.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (sent) {
    /*
     * A `Card`, as the team invitation confirms, and not a `SetupPanel`. That
     * panel is two columns on a desktop: with nothing to put in the second one
     * it left half the screen blank beside the message.
     */
    const asked = catalog.filter((scope) => sent.scope_codes.includes(scope.scope_code))
    return (
      <Card aria-live="polite">
        <CardHeader>
          <CardDescription>
            {sent.reused ? 'Invitación reenviada' : 'Invitación enviada'}
          </CardDescription>
          <CardTitle role="heading" aria-level={2}>
            La invitación va en camino.
          </CardTitle>
          <CardAction>
            <Badge variant="warning">Pendiente</Badge>
          </CardAction>
        </CardHeader>
        <CardContent data-client-invitation-result>
          <p>
            {/* The honest summary: nothing exists on our side until they
                answer. No person, no relationship, no access to anything. */}
            Enviamos la invitación a <strong>{sent.contact_hint}</strong>. Hasta que la persona
            responda no existe ningún vínculo ni permiso, y puede aceptar unos y rechazar otros.
          </p>
          <dl data-client-invitation-summary>
            <div>
              <dt>Permisos pedidos</dt>
              <dd>{asked.map((scope) => scope.display_name).join(', ')}</dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>
                {new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(
                  new Date(sent.expires_at),
                )}
              </dd>
            </div>
          </dl>
          <div data-client-invitation-actions>
            <Button
              onClick={() => {
                setSent(undefined)
                setContact('')
                setScopeCodes([])
                setErrors({})
                setCommand(newCommand())
              }}
            >
              Invitar a otra persona
            </Button>
            <Link
              href={directoryPath}
              data-slot="button"
              data-variant="ghost"
              className={buttonVariants({ variant: 'ghost' })}
            >
              Ver el directorio
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  const loadingCatalog = scopesQuery.isPending || rolesQuery.isPending

  return (
    <SetupPanel>
      <SetupPanelIntro>
        <SetupPanelEyebrow>Clientes</SetupPanelEyebrow>
        <SetupPanelTitle as="h2">Invita a una persona.</SetupPanelTitle>
        <SetupPanelDescription>
          Elige qué quieres poder ver. La persona decidirá cada permiso por separado, y lo que
          rechace no lo veremos.
        </SetupPanelDescription>
      </SetupPanelIntro>

      <SetupPanelContent>
        <form data-studio-form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.contact)}>
              <FieldLabel htmlFor="client-invitation-email">Correo electrónico</FieldLabel>
              <Input
                id="client-invitation-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                aria-invalid={Boolean(errors.contact)}
              />
              <FieldDescription>Solo se usará para entregar esta invitación.</FieldDescription>
              {errors.contact ? <FieldError>{errors.contact}</FieldError> : null}
            </Field>
          </FieldGroup>

          <FieldSet>
            <FieldLegend>Qué quieres poder ver</FieldLegend>

            {loadingCatalog ? (
              <FieldDescription role="status">
                <Spinner label="Cargando permisos" />
                Cargando los permisos que puedes pedir…
              </FieldDescription>
            ) : scopesQuery.isError ? (
              <Alert variant="danger">
                <AlertTitle>No pudimos cargar los permisos</AlertTitle>
                <AlertDescription>
                  Sin ellos no se puede armar una invitación. Inténtalo de nuevo en un momento.
                </AlertDescription>
              </Alert>
            ) : catalog.length === 0 ? (
              /* The catalogue is published from Backoffice. Until somebody
                 curates it there is nothing to ask for, and saying so beats
                 leaving an empty box with no explanation. */
              <Alert variant="warning">
                <AlertTitle>Todavía no hay permisos publicados</AlertTitle>
                <AlertDescription>
                  No se puede invitar hasta que se publique el catálogo de permisos. Mientras tanto
                  sí puedes consultar qué abarca cada categoría de información.
                </AlertDescription>
                {/* La referencia no depende del catálogo publicado, así que es
                    lo único útil que ofrecer desde aquí mientras nadie lo cure. */}
                <AlertAction>
                  <Link
                    href={`/organizations/${current.organization_id}/clients/information-categories`}
                    data-slot="button"
                    data-variant="outline"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Ver las categorías de información
                  </Link>
                </AlertAction>
              </Alert>
            ) : (
              catalog.map((scope) => (
                <Field key={scope.scope_code} orientation="horizontal">
                  <Checkbox
                    id={`scope-${scope.scope_code}`}
                    checked={scopeCodes.includes(scope.scope_code)}
                    onCheckedChange={() =>
                      setScopeCodes((chosen) => toggleScope(chosen, scope.scope_code, catalog))
                    }
                  />
                  {/* Name and summary on one line, not stacked: as two blocks
                      the pair read as unrelated and the gap between them was
                      the loudest thing in the row.

                      The whole description is deliberately absent. It is
                      written for the person deciding whether to hand over their
                      injuries, and seven of those paragraphs is a wall a
                      professional reads none of. The summary keeps the
                      boundary, which is the half worth keeping when there is
                      one line to spend. */}
                  <FieldLabel htmlFor={`scope-${scope.scope_code}`}>
                    {`${scope.display_name}: ${scope.summary}`}
                  </FieldLabel>
                </Field>
              ))
            )}

            {errors.scopes ? <FieldError>{errors.scopes}</FieldError> : null}
          </FieldSet>

          {quota ? (
            <FieldDescription data-guest-quota-summary>{quotaSummary(quota)}</FieldDescription>
          ) : null}

          {blockedReason ? (
            <Alert variant="warning" data-guest-quota-blocked>
              <AlertTitle>No puedes invitar a nadie nuevo ahora</AlertTitle>
              <AlertDescription>
                {blockedReason} {QUOTA_RULE_NOTE}
              </AlertDescription>
            </Alert>
          ) : null}

          {failure ? <FieldError>{failure}</FieldError> : null}

          <SetupPanelActions>
            <Button
              type="submit"
              size="lg"
              disabled={submitting || catalog.length === 0 || Boolean(blockedReason)}
            >
              {submitting ? <Spinner label="Enviando la invitación" /> : null}
              {submitting ? 'Enviando…' : 'Enviar invitación'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => router.replace(directoryPath)}
            >
              Cancelar
            </Button>
          </SetupPanelActions>
        </form>
      </SetupPanelContent>
    </SetupPanel>
  )
}

const GENERIC_FAILURE =
  'La conexión falló. Conservamos el intento para que puedas reintentar sin enviar dos invitaciones.'

function invitationError(error: StudioApiError): string {
  if (error.status === 403) return 'Tu rol ya no permite invitar clientes en esta organización.'
  if (error.code === 'guest-quota-full') return QUOTA_FULL_MESSAGE
  if (error.status === 409) return 'Esa invitación ya se envió. Revisa el directorio.'
  if (error.status === 422) return 'Revisa el correo y los permisos marcados.'
  if (error.status === 429) {
    return 'Se enviaron demasiadas invitaciones seguidas. Inténtalo más tarde.'
  }
  if (error.status === 503) return 'Invitar clientes está temporalmente deshabilitado.'
  return GENERIC_FAILURE
}
