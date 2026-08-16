'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  ChoiceCard,
  ChoiceCardAction,
  ChoiceCardDescription,
  ChoiceCardEyebrow,
  ChoiceCardTitle,
} from '@allfitone/react/components/choice-card'
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
import { RadioGroup, RadioGroupItem } from '@allfitone/react/components/radio-group'
import {
  SetupPanel,
  SetupPanelActions,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { useState, type FormEvent } from 'react'

import { StudioFrame } from './studio-frame'
import { createCommandIntentManager } from '@/lib/command-intent'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type OrganizationCreated,
  type OrganizationType,
} from '@/lib/studio-api'

type StartMode = 'individual' | 'team'
type ResponsibleKind = 'natural_person' | 'legal_entity'

export function SpaceSetup({
  organizationTypes,
  fullName,
  onCreated,
  onWait,
  onSessionExpired,
}: {
  organizationTypes: OrganizationType[]
  fullName?: string | undefined
  onCreated: (organization: OrganizationCreated) => void
  onWait: () => void
  onSessionExpired: () => void
}) {
  const [mode, setMode] = useState<StartMode>()

  return (
    <StudioFrame step="space">
      {mode ? (
        <SpaceForm
          mode={mode}
          organizationTypes={organizationTypes}
          fullName={fullName}
          onBack={() => setMode(undefined)}
          onCreated={onCreated}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <SetupPanel>
          <SetupPanelIntro>
            <SetupPanelEyebrow>Elige cómo empezar</SetupPanelEyebrow>
            <SetupPanelTitle>¿Cómo trabajas hoy?</SetupPanelTitle>
            <SetupPanelDescription>
              Elige la estructura que mejor representa tu trabajo. Podrás ampliarla después.
            </SetupPanelDescription>
          </SetupPanelIntro>
          <SetupPanelContent data-studio-choice-grid>
            <ChoiceCard onClick={() => setMode('individual')}>
              <ChoiceCardEyebrow>Para mí</ChoiceCardEyebrow>
              <ChoiceCardTitle>Trabajo por mi cuenta</ChoiceCardTitle>
              <ChoiceCardDescription>
                Crea tu espacio profesional. Tú quedarás como responsable y propietario.
              </ChoiceCardDescription>
              <ChoiceCardAction>Crear mi espacio</ChoiceCardAction>
            </ChoiceCard>
            <ChoiceCard onClick={() => setMode('team')}>
              <ChoiceCardEyebrow>Para un equipo</ChoiceCardEyebrow>
              <ChoiceCardTitle>Tengo un equipo o centro</ChoiceCardTitle>
              <ChoiceCardDescription>
                Configura un gimnasio, estudio u otro espacio para tu equipo.
              </ChoiceCardDescription>
              <ChoiceCardAction>Crear un espacio de equipo</ChoiceCardAction>
            </ChoiceCard>
            <ChoiceCard variant="muted" onClick={onWait}>
              <ChoiceCardEyebrow>Más adelante</ChoiceCardEyebrow>
              <ChoiceCardTitle>Esperar una invitación</ChoiceCardTitle>
              <ChoiceCardDescription>
                No tienes que crear un espacio ahora. Vuelve cuando un equipo te haya invitado.
              </ChoiceCardDescription>
              <ChoiceCardAction>Esperar una invitación</ChoiceCardAction>
            </ChoiceCard>
          </SetupPanelContent>
        </SetupPanel>
      )}
    </StudioFrame>
  )
}

function SpaceForm({
  mode,
  organizationTypes,
  fullName,
  onBack,
  onCreated,
  onSessionExpired,
}: {
  mode: StartMode
  organizationTypes: OrganizationType[]
  fullName?: string | undefined
  onBack: () => void
  onCreated: (organization: OrganizationCreated) => void
  onSessionExpired: () => void
}) {
  const [displayName, setDisplayName] = useState(
    mode === 'individual' ? (fullName ? `Espacio de ${fullName}` : 'Mi espacio profesional') : '',
  )
  const [typeCode, setTypeCode] = useState<OrganizationType['code']>(
    mode === 'individual' ? 'professional_practice' : 'studio',
  )
  const [responsibleKind, setResponsibleKind] = useState<ResponsibleKind>('natural_person')
  const [responsibleName, setResponsibleName] = useState('')
  const [commandIntent] = useState(() => createCommandIntentManager(newCommand))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  const legalNameRequired = mode === 'team' && responsibleKind === 'legal_entity'
  const valid =
    displayName.trim().length > 0 && (!legalNameRequired || responsibleName.trim().length > 0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setError(undefined)
    try {
      const body = {
        display_name: displayName.trim(),
        type_code: mode === 'individual' ? ('professional_practice' as const) : typeCode,
        responsible_party: {
          kind: mode === 'individual' ? ('natural_person' as const) : responsibleKind,
          name:
            mode === 'individual' || responsibleKind === 'natural_person'
              ? (fullName ?? 'Titular autenticado')
              : responsibleName.trim(),
        },
      }
      const command = commandIntent.commandFor({
        operation: 'organization:create',
        resourceId: null,
        payload: body,
      })
      const created = await studioApi.createOrganization(body, command)
      commandIntent.reset()
      onCreated(created)
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        onSessionExpired()
        return
      }
      setError(
        caught instanceof StudioApiError && caught.status === 503
          ? 'No pudimos crear el espacio. El reintento conservará la misma operación.'
          : 'No pudimos crear el espacio con esos datos. Revisa la información e inténtalo de nuevo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SetupPanel>
      <SetupPanelIntro>
        <SetupPanelEyebrow>
          {mode === 'individual' ? 'Profesional independiente' : 'Equipo o centro'}
        </SetupPanelEyebrow>
        <SetupPanelTitle>
          {mode === 'individual' ? 'Dale nombre a tu espacio.' : 'Dale identidad a tu espacio.'}
        </SetupPanelTitle>
        <SetupPanelDescription>
          Al crearlo, quedará activo y tú serás su propietario.
        </SetupPanelDescription>
      </SetupPanelIntro>

      <SetupPanelContent>
        <form data-studio-form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="organization-name">Nombre visible</FieldLabel>
              <Input
                id="organization-name"
                name="organizationName"
                maxLength={120}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
              <FieldDescription>Así reconocerás el espacio dentro de Studio.</FieldDescription>
            </Field>

            {mode === 'team' ? (
              <>
                <Field>
                  <FieldLabel htmlFor="organization-type">Tipo de organización</FieldLabel>
                  <Select
                    value={typeCode}
                    onValueChange={(value) => {
                      if (value !== null) setTypeCode(value)
                    }}
                    items={organizationTypes.map((type) => ({
                      label: type.name,
                      value: type.code,
                    }))}
                  >
                    <SelectTrigger id="organization-type" data-studio-select-trigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {organizationTypes.map((type) => (
                        <SelectItem key={type.code} value={type.code}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <FieldSet>
                  <FieldLegend>Parte responsable</FieldLegend>
                  <RadioGroup
                    value={responsibleKind}
                    onValueChange={(value) => {
                      if (value === 'natural_person' || value === 'legal_entity') {
                        setResponsibleKind(value)
                      }
                    }}
                    aria-label="Parte responsable"
                    data-studio-responsible-options
                  >
                    <Field orientation="horizontal">
                      <RadioGroupItem id="responsible-natural-person" value="natural_person" />
                      <FieldLabel htmlFor="responsible-natural-person">Persona natural</FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                      <RadioGroupItem id="responsible-legal-entity" value="legal_entity" />
                      <FieldLabel htmlFor="responsible-legal-entity">Entidad</FieldLabel>
                    </Field>
                  </RadioGroup>
                  <FieldDescription>
                    Si eliges persona natural, tú quedarás como responsable.
                  </FieldDescription>
                </FieldSet>

                {responsibleKind === 'legal_entity' ? (
                  <Field>
                    <FieldLabel htmlFor="responsible-name">Nombre legal de la entidad</FieldLabel>
                    <Input
                      id="responsible-name"
                      name="responsibleName"
                      maxLength={160}
                      value={responsibleName}
                      onChange={(event) => setResponsibleName(event.target.value)}
                      required
                    />
                  </Field>
                ) : null}
              </>
            ) : (
              <Alert variant="info">
                <AlertTitle>Responsable natural</AlertTitle>
                <AlertDescription>
                  Tu nombre quedará registrado como responsable de este espacio.
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>

          {error ? <FieldError>{error}</FieldError> : null}

          <SetupPanelActions>
            <Button type="submit" size="lg" disabled={!valid || submitting}>
              {submitting
                ? 'Creando…'
                : mode === 'individual'
                  ? 'Crear mi espacio'
                  : 'Crear el espacio'}
            </Button>
            <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
              Volver
            </Button>
          </SetupPanelActions>
        </form>
      </SetupPanelContent>
    </SetupPanel>
  )
}
