'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Checkbox } from '@allfitone/react/components/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  Field,
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
  SetupPanelNote,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import { useState, type FormEvent } from 'react'

import { StudioFrame } from './studio-frame'
import { createCommandIntentManager } from '@/lib/command-intent'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type OnboardingAttempt,
  type StudioEntryContext,
} from '@/lib/studio-api'

export function ActivationForm({
  attempt,
  identity,
  onComplete,
  onSessionExpired,
  onRetryAttempt,
}: {
  attempt: OnboardingAttempt
  identity: StudioEntryContext['identity']
  onComplete: (fullName: string) => void
  onSessionExpired: () => void
  onRetryAttempt: () => Promise<void>
}) {
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [adult, setAdult] = useState(false)
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [evidenceCommandIntent] = useState(() => createCommandIntentManager(newCommand))
  const [completionCommandIntent] = useState(() => createCommandIntentManager(newCommand))
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [expired, setExpired] = useState(() => new Date(attempt.expires_at).getTime() <= Date.now())
  const [error, setError] = useState<string>()

  const completeName =
    identity.name !== null || (givenName.trim().length > 0 && familyName.trim().length > 0)
  const valid = completeName && adult && terms && privacy

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
      const evidenceBody = { declared_adult: true }
      const completion = completionBody()
      const evidenceCommand = evidenceCommandIntent.commandFor({
        operation: 'onboarding:eligibility-evidence',
        resourceId: attempt.id,
        payload: evidenceBody,
      })
      const completionCommand = completionCommandIntent.commandFor({
        operation: 'onboarding:complete',
        resourceId: attempt.id,
        payload: completion,
      })
      await studioApi.recordAdultEligibility(attempt.id, true, evidenceCommand)
      await studioApi.completeOnboarding(attempt.id, completion, completionCommand)
      evidenceCommandIntent.reset()
      completionCommandIntent.reset()
      onComplete(identity.name ?? `${givenName.trim()} ${familyName.trim()}`)
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        onSessionExpired()
        return
      }
      if (caught instanceof StudioApiError && caught.status === 409) {
        evidenceCommandIntent.reset()
        completionCommandIntent.reset()
        onComplete(identity.name ?? `${givenName.trim()} ${familyName.trim()}`)
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

  function completionBody() {
    return {
      ...(identity.name ? {} : { given_name: givenName.trim(), family_name: familyName.trim() }),
      terms_accepted: true as const,
      privacy_notice_accepted: true as const,
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
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Activación personal</SetupPanelEyebrow>
          <SetupPanelTitle>Confirma y deja tu identidad lista.</SetupPanelTitle>
          <SetupPanelDescription>
            Tu nombre ya viene de tu cuenta. Solo tú puedes confirmar tu mayoría de edad y las
            aceptaciones.
          </SetupPanelDescription>
          <SetupPanelNote>
            <span aria-hidden="true">18+</span>
            <p>Declaras ser mayor de edad. No pedimos ni guardamos tu fecha de nacimiento.</p>
          </SetupPanelNote>
        </SetupPanelIntro>

        <SetupPanelContent>
          <form data-studio-form onSubmit={submit} noValidate>
            <FieldGroup>
              {identity.name ? (
                <Card data-studio-identity-summary>
                  <CardHeader>
                    <CardTitle>Nombre de tu cuenta</CardTitle>
                    <CardDescription>
                      Usaremos este nombre para crear tu identidad personal en Allfit One.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <strong>{identity.name}</strong>
                  </CardContent>
                </Card>
              ) : (
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
              )}

              <FieldSet>
                <FieldLegend>Confirmaciones obligatorias</FieldLegend>
                <Field orientation="horizontal">
                  <Checkbox
                    id="adult-confirmation"
                    checked={adult}
                    onCheckedChange={(checked) => setAdult(checked === true)}
                  />
                  <FieldLabel htmlFor="adult-confirmation">
                    Declaro que tengo al menos 18 años y estoy en Colombia.
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="terms-confirmation"
                    checked={terms}
                    onCheckedChange={(checked) => setTerms(checked === true)}
                  />
                  <FieldLabel htmlFor="terms-confirmation">
                    Acepto los Términos de la plataforma.
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="privacy-confirmation"
                    checked={privacy}
                    onCheckedChange={(checked) => setPrivacy(checked === true)}
                  />
                  <FieldLabel htmlFor="privacy-confirmation">
                    Acepto el Aviso de privacidad.
                  </FieldLabel>
                </Field>
              </FieldSet>
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

            <SetupPanelActions>
              <Button type="submit" size="lg" disabled={!valid || submitting || expired}>
                {submitting ? 'Confirmando…' : 'Confirmar mi identidad'}
              </Button>
              <p aria-live="polite">
                {submitting ? 'Guardando la declaración y las aceptaciones…' : 'Paso 1 de 3'}
              </p>
            </SetupPanelActions>
          </form>
        </SetupPanelContent>
      </SetupPanel>
    </StudioFrame>
  )
}
