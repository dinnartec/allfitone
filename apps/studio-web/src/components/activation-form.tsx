'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Checkbox } from '@allfitone/react/components/checkbox'
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
import { StudioApiError, newCommand, studioApi, type OnboardingAttempt } from '@/lib/studio-api'

export function ActivationForm({
  attempt,
  onComplete,
  onSessionExpired,
  onRetryAttempt,
}: {
  attempt: OnboardingAttempt
  onComplete: (fullName: string) => void
  onSessionExpired: () => void
  onRetryAttempt: () => Promise<void>
}) {
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [adult, setAdult] = useState(false)
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [evidenceCommand] = useState(newCommand)
  const [completionCommand] = useState(newCommand)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [expired, setExpired] = useState(() => new Date(attempt.expires_at).getTime() <= Date.now())
  const [error, setError] = useState<string>()

  const valid =
    givenName.trim().length > 0 && familyName.trim().length > 0 && adult && terms && privacy

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || submitting) return
    if (new Date(attempt.expires_at).getTime() <= Date.now()) {
      setExpired(true)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await studioApi.recordAdultEligibility(attempt.id, true, evidenceCommand)
      await studioApi.completeOnboarding(
        attempt.id,
        {
          given_name: givenName.trim(),
          family_name: familyName.trim(),
          terms_accepted: true,
          privacy_notice_accepted: true,
        },
        completionCommand,
      )
      onComplete(`${givenName.trim()} ${familyName.trim()}`)
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        onSessionExpired()
        return
      }
      if (caught instanceof StudioApiError && caught.status === 409) {
        onComplete(`${givenName.trim()} ${familyName.trim()}`)
        return
      }
      if (caught instanceof StudioApiError && caught.status === 400) {
        setExpired(true)
        return
      }
      setError(
        caught instanceof StudioApiError && caught.status === 503
          ? 'No pudimos guardar tu activación. Tus datos siguen aquí; inténtalo de nuevo.'
          : 'No pudimos completar la activación. Revisa los datos e inténtalo de nuevo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function retryAttempt() {
    setRetrying(true)
    setError(undefined)
    try {
      await onRetryAttempt()
      setExpired(false)
    } catch {
      setError('No pudimos abrir un nuevo intento. Vuelve a intentarlo en unos segundos.')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <StudioFrame step="identity">
      <article data-studio-panel="activation">
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Activación personal</p>
          <h1>Primero, pongamos tu identidad en regla.</h1>
          <p>
            Esta activación es tuya. Ninguna organización ni administrador puede completarla por ti.
          </p>
          <div data-studio-signal-note>
            <span aria-hidden="true">18+</span>
            <p>En esta versión declaras ser mayor de edad. No guardamos tu fecha de nacimiento.</p>
          </div>
        </div>

        <form data-studio-form onSubmit={submit} noValidate>
          <FieldGroup>
            <div data-studio-field-grid>
              <Field>
                <FieldLabel htmlFor="given-name">Nombres</FieldLabel>
                <Input
                  id="given-name"
                  name="givenName"
                  autoComplete="given-name"
                  maxLength={100}
                  value={givenName}
                  onChange={(event) => setGivenName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="family-name">Apellidos</FieldLabel>
                <Input
                  id="family-name"
                  name="familyName"
                  autoComplete="family-name"
                  maxLength={100}
                  value={familyName}
                  onChange={(event) => setFamilyName(event.target.value)}
                  required
                />
              </Field>
            </div>

            <fieldset data-studio-check-group>
              <legend>Confirmaciones obligatorias</legend>
              <label data-studio-check>
                <Checkbox
                  checked={adult}
                  onCheckedChange={(checked) => setAdult(checked === true)}
                />
                <span>Declaro que tengo al menos 18 años y estoy en Colombia.</span>
              </label>
              <label data-studio-check>
                <Checkbox
                  checked={terms}
                  onCheckedChange={(checked) => setTerms(checked === true)}
                />
                <span>Acepto los Términos de la plataforma, versión 1.</span>
              </label>
              <label data-studio-check>
                <Checkbox
                  checked={privacy}
                  onCheckedChange={(checked) => setPrivacy(checked === true)}
                />
                <span>Acepto el Aviso de privacidad, versión 1.</span>
              </label>
              <FieldDescription>
                Los textos legales consultables se incorporarán en un corte posterior; esta
                aceptación queda registrada con su versión.
              </FieldDescription>
            </fieldset>
          </FieldGroup>

          {expired ? (
            <Alert variant="warning" live="polite">
              <AlertTitle>La activación venció</AlertTitle>
              <AlertDescription>
                Abre un nuevo intento para continuar sin volver a iniciar sesión.
              </AlertDescription>
              <Button type="button" variant="outline" onClick={retryAttempt} disabled={retrying}>
                {retrying ? 'Abriendo…' : 'Reintentar activación'}
              </Button>
            </Alert>
          ) : null}

          {error ? <FieldError>{error}</FieldError> : null}

          <div data-studio-form-actions>
            <Button type="submit" size="lg" disabled={!valid || submitting || expired}>
              {submitting ? 'Activando…' : 'Activar mi identidad'}
            </Button>
            <p aria-live="polite">
              {submitting ? 'Guardando la declaración y las aceptaciones…' : 'Paso 1 de 3'}
            </p>
          </div>
        </form>
      </article>
    </StudioFrame>
  )
}
