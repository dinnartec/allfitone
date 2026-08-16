'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Card, CardContent } from '@allfitone/react/components/card'
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
  SetupPanelNote,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { StudioApiError, newCommand, studioApi, type TeamInvitation } from '@/lib/studio-api'
import {
  canInviteTeam,
  invitationRoleLabel,
  invitationRoleOptions,
  type TeamInvitationRole,
} from '@/lib/team-invitations'

const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'

export function TeamInvitationForm() {
  const router = useRouter()
  const { current } = useOrganizationContext()
  const roleOptions = invitationRoleOptions(current.roles)
  const [contact, setContact] = useState('')
  const [role, setRole] = useState<TeamInvitationRole>(roleOptions[0]?.value ?? 'staff')
  const [command, setCommand] = useState(newCommand)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState<TeamInvitation>()

  if (!INVITATIONS_ENABLED || !canInviteTeam(current.roles)) {
    return (
      <section data-team-invitation-state>
        <Alert variant="warning">
          <AlertTitle>Las invitaciones todavía no están disponibles</AlertTitle>
          <AlertDescription>
            Esta función se habilitará cuando el flujo seguro de recepción esté publicado.
          </AlertDescription>
          <Button onClick={() => router.replace(`/organizations/${current.organization_id}`)}>
            Volver al espacio
          </Button>
        </Alert>
      </section>
    )
  }

  function changeContact(value: string) {
    setContact(value)
    setCommand(newCommand())
    setCreated(undefined)
  }

  function changeRole(value: TeamInvitationRole) {
    setRole(value)
    setCommand(newCommand())
    setCreated(undefined)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !contact.trim()) return
    setSubmitting(true)
    setError(undefined)
    try {
      const invitation = await studioApi.createTeamInvitation(
        current.organization_id,
        {
          channel: 'email',
          contact: contact.trim().toLowerCase(),
          intents: [{ kind: 'membership', proposed_role_code: role }],
        },
        command,
      )
      setCreated(invitation)
    } catch (caught) {
      if (caught instanceof StudioApiError) setError(invitationError(caught))
      else {
        setError(
          'No pudimos enviar la invitación. Conservamos el intento para que puedas reintentar.',
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (created) {
    const intent = created.intents[0]
    return (
      <Card data-team-invitation-result aria-live="polite">
        <CardContent>
          <div>
            <p data-studio-eyebrow>
              {created.reused ? 'Invitación actualizada' : 'Invitación creada'}
            </p>
            <h2>La propuesta quedó pendiente.</h2>
            <p>
              Enviamos la invitación a <strong>{created.contact_hint}</strong>. La membresía solo se
              creará si la persona acepta.
            </p>
          </div>
          <dl>
            <div>
              <dt>Rol propuesto</dt>
              <dd>{intent ? invitationRoleLabel(intent.proposed_role_code) : 'Staff'}</dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>
                {new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(
                  new Date(created.expires_at),
                )}
              </dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <Badge variant="warning">Pendiente</Badge>
              </dd>
            </div>
          </dl>
          <div data-team-invitation-actions>
            <Button
              onClick={() => {
                setContact('')
                setCreated(undefined)
                setCommand(newCommand())
              }}
            >
              Invitar a alguien más
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.replace(`/organizations/${current.organization_id}`)}
            >
              Volver al espacio
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <SetupPanel>
      <SetupPanelIntro>
        <SetupPanelEyebrow>Tu equipo</SetupPanelEyebrow>
        <SetupPanelTitle as="h2">Invita con una propuesta clara.</SetupPanelTitle>
        <SetupPanelDescription>
          Define el correo y el rol. No crearemos una cuenta ni una membresía antes de la
          aceptación.
        </SetupPanelDescription>
        <SetupPanelNote>
          <span>7</span>
          <p>La invitación estará disponible durante siete días.</p>
        </SetupPanelNote>
      </SetupPanelIntro>

      <SetupPanelContent>
        <form data-studio-form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invitation-email">Correo electrónico</FieldLabel>
              <Input
                id="invitation-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={contact}
                onChange={(event) => changeContact(event.target.value)}
                required
              />
              <FieldDescription>Solo se usará para entregar esta invitación.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="invitation-role">Rol propuesto</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => {
                  if (value === 'admin' || value === 'coach' || value === 'staff') changeRole(value)
                }}
                items={roleOptions}
              >
                <SelectTrigger id="invitation-role" data-studio-select-trigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                La persona podrá revisar esta propuesta antes de aceptarla.
              </FieldDescription>
            </Field>
          </FieldGroup>

          {error ? <FieldError>{error}</FieldError> : null}
          <SetupPanelActions>
            <Button type="submit" size="lg" disabled={submitting || !contact.trim()}>
              {submitting ? 'Enviando…' : 'Enviar invitación'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() =>
                router.replace(`/organizations/${current.organization_id}/team/invitations`)
              }
            >
              Cancelar
            </Button>
          </SetupPanelActions>
        </form>
      </SetupPanelContent>
    </SetupPanel>
  )
}

function invitationError(error: StudioApiError): string {
  if (error.status === 403) return 'Tu rol actual no permite crear esta invitación.'
  if (error.status === 404) return 'Ya no tienes acceso activo a esta organización.'
  if (error.status === 503) {
    return 'Las invitaciones están pausadas temporalmente. Reintenta más tarde.'
  }
  if (error.status === 422) return 'Revisa el correo y el rol propuesto.'
  return 'No pudimos enviar la invitación. Reintenta sin cambiar los datos.'
}
