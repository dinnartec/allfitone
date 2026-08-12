'use client'

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
import { RadioGroup, RadioGroupItem } from '@allfitone/react/components/radio-group'
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
import { StudioApiError, newCommand, studioApi, type OrganizationType } from '@/lib/studio-api'

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
  onCreated: (organizationId: string) => void
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
        <article data-studio-panel="choice">
          <div data-studio-panel-intro>
            <p data-studio-eyebrow>Elige cómo empezar</p>
            <h1>¿Cómo trabajas hoy?</h1>
            <p>Elige la estructura que mejor representa tu trabajo. Podrás ampliarla después.</p>
          </div>
          <div data-studio-choice-grid>
            <button type="button" data-studio-choice onClick={() => setMode('individual')}>
              <span data-choice-kicker>Para mí</span>
              <strong>Trabajo por mi cuenta</strong>
              <span>Crea tu espacio profesional. Tú quedarás como responsable y propietario.</span>
              <span data-choice-action>Crear mi espacio →</span>
            </button>
            <button type="button" data-studio-choice onClick={() => setMode('team')}>
              <span data-choice-kicker>Para un equipo</span>
              <strong>Tengo un equipo o centro</strong>
              <span>Configura un gimnasio, estudio u otro espacio para tu equipo.</span>
              <span data-choice-action>Crear un espacio de equipo →</span>
            </button>
            <button type="button" data-studio-choice="waiting" onClick={onWait}>
              <span data-choice-kicker>Más adelante</span>
              <strong>Esperar una invitación</strong>
              <span>
                No tienes que crear un espacio ahora. Vuelve cuando un equipo te haya invitado.
              </span>
              <span data-choice-action>Esperar una invitación →</span>
            </button>
          </div>
        </article>
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
  onCreated: (organizationId: string) => void
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
      onCreated(created.id)
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
    <article data-studio-panel="space-form">
      <div data-studio-panel-intro>
        <p data-studio-eyebrow>
          {mode === 'individual' ? 'Profesional independiente' : 'Equipo o centro'}
        </p>
        <h1>
          {mode === 'individual' ? 'Dale nombre a tu espacio.' : 'Dale identidad a tu espacio.'}
        </h1>
        <p>Al crearlo, quedará activo y tú serás su propietario.</p>
      </div>

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

              <fieldset data-studio-responsible-group>
                <legend>Parte responsable</legend>
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
                  <label data-studio-responsible-option>
                    <RadioGroupItem value="natural_person" />
                    <span>Persona natural</span>
                  </label>
                  <label data-studio-responsible-option>
                    <RadioGroupItem value="legal_entity" />
                    <span>Entidad</span>
                  </label>
                </RadioGroup>
                <FieldDescription>
                  Si eliges persona natural, tú quedarás como responsable.
                </FieldDescription>
              </fieldset>

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

        <div data-studio-form-actions>
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
        </div>
      </form>
    </article>
  )
}
