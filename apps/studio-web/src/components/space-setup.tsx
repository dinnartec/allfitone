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
import { useState, type FormEvent } from 'react'

import { StudioFrame } from './studio-frame'
import { StudioApiError, newCommand, studioApi, type OrganizationType } from '@/lib/studio-api'

type StartMode = 'individual' | 'team'
type ResponsibleKind = 'natural_person' | 'legal_entity'

export function SpaceSetup({
  organizationTypes,
  fullName,
  onCreated,
  onSessionExpired,
}: {
  organizationTypes: OrganizationType[]
  fullName?: string | undefined
  onCreated: (organizationId: string) => void
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
            <h1>Tu trabajo necesita un espacio propio.</h1>
            <p>
              Define la estructura inicial. Podrás ampliar el equipo y la operación en cortes
              posteriores.
            </p>
          </div>
          <div data-studio-choice-grid>
            <button type="button" data-studio-choice onClick={() => setMode('individual')}>
              <span data-choice-index>01</span>
              <strong>Trabajo por mi cuenta</strong>
              <span>
                Crea una práctica profesional en la que tú eres la persona responsable y owner.
              </span>
              <span data-choice-action>Elegir práctica individual →</span>
            </button>
            <button type="button" data-studio-choice onClick={() => setMode('team')}>
              <span data-choice-index>02</span>
              <strong>Tengo un equipo o centro</strong>
              <span>
                Configura un gimnasio, estudio, academia, clínica o práctica con responsable
                gobernado.
              </span>
              <span data-choice-action>Elegir espacio de equipo →</span>
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
    mode === 'individual' ? (fullName ? `Práctica de ${fullName}` : 'Mi práctica profesional') : '',
  )
  const [typeCode, setTypeCode] = useState<OrganizationType['code']>(
    mode === 'individual' ? 'professional_practice' : 'studio',
  )
  const [responsibleKind, setResponsibleKind] = useState<ResponsibleKind>('natural_person')
  const [responsibleName, setResponsibleName] = useState('')
  const [command] = useState(newCommand)
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
      const created = await studioApi.createOrganization(
        {
          display_name: displayName.trim(),
          type_code: mode === 'individual' ? 'professional_practice' : typeCode,
          responsible_party: {
            kind: mode === 'individual' ? 'natural_person' : responsibleKind,
            name:
              mode === 'individual' || responsibleKind === 'natural_person'
                ? (fullName ?? 'Titular autenticado')
                : responsibleName.trim(),
          },
        },
        command,
      )
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
          {mode === 'individual' ? 'Práctica individual' : 'Equipo o centro'}
        </p>
        <h1>
          {mode === 'individual'
            ? 'Ponle nombre a tu práctica.'
            : 'Define la identidad del espacio.'}
        </h1>
        <p>
          La organización quedará activa y tu membresía se creará con el rol owner en una sola
          operación.
        </p>
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
                <select
                  id="organization-type"
                  data-studio-native-control
                  value={typeCode}
                  onChange={(event) => setTypeCode(event.target.value as OrganizationType['code'])}
                >
                  {organizationTypes.map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>

              <fieldset data-studio-segment-group>
                <legend>Parte responsable</legend>
                <div>
                  <button
                    type="button"
                    data-selected={responsibleKind === 'natural_person'}
                    onClick={() => setResponsibleKind('natural_person')}
                  >
                    Persona natural
                  </button>
                  <button
                    type="button"
                    data-selected={responsibleKind === 'legal_entity'}
                    onClick={() => setResponsibleKind('legal_entity')}
                  >
                    Entidad
                  </button>
                </div>
                <FieldDescription>
                  Si eliges persona natural, el responsable será el titular autenticado.
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
                El titular autenticado quedará registrado como responsable de esta práctica.
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        {error ? <FieldError>{error}</FieldError> : null}

        <div data-studio-form-actions>
          <Button type="submit" size="lg" disabled={!valid || submitting}>
            {submitting ? 'Creando espacio…' : 'Crear mi espacio'}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
            Volver
          </Button>
        </div>
      </form>
    </article>
  )
}
