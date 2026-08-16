'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@allfitone/react/components/card'
import {
  Combobox,
  ComboboxActions,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from '@allfitone/react/components/combobox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import { Spinner } from '@allfitone/react/components/spinner'
import { StatStrip, StatStripItem } from '@allfitone/react/components/stat-strip'
import { Textarea } from '@allfitone/react/components/textarea'
import { toast } from '@allfitone/react/components/sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type FormEvent } from 'react'

import { createCommandIntentManager } from '@/lib/command-intent'
import { useStudioSessionMutation } from './studio-query-provider'
import {
  hasErrors,
  mergeSpecialtyCatalog,
  validateProfile,
  type ProfileErrors,
} from '@/lib/professional-profile'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type ProfessionalCatalogItem,
  type ProfessionalProfile,
  type ProfessionalProfilePut,
  type StudioMe,
} from '@/lib/studio-api'
import {
  isStudioQuerySessionCancelled,
  studioQueryKeys,
  updateProfessionalProfileInMe,
} from '@/lib/studio-query'

type SpecialtyOption = ProfessionalCatalogItem & { available: boolean }

export function ProfessionalPresentation({
  profile,
  specialties,
  onSaved,
  onSessionFailure,
}: {
  profile: ProfessionalProfile | null
  specialties: ProfessionalCatalogItem[]
  onSaved: (profile: ProfessionalProfile) => void
  onSessionFailure: (error: unknown) => boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ProfessionalProfilePut>(() => profileDraft(profile))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [remoteError, setRemoteError] = useState<string>()
  const submissionLock = useRef(false)
  const [commandIntent] = useState(() => createCommandIntentManager(newCommand))
  const saveMutation = useStudioSessionMutation({
    mutationFn: (
      {
        payload,
        command,
      }: {
        payload: ProfessionalProfilePut
        command: CommandHeaders
      },
      signal,
    ) => studioApi.updateProfessionalProfile(payload, command, signal),
    onSuccess: (saved) => {
      queryClient.setQueryData<StudioMe>(studioQueryKeys.me(), (current) =>
        updateProfessionalProfileInMe(current, saved),
      )
    },
  })
  const options = useMemo(
    () => mergeSpecialtyCatalog(specialties, profile?.specialties ?? []),
    [profile?.specialties, specialties],
  )
  const selectedOptions = options.filter((option) => draft.specialty_codes.includes(option.code))
  const publishedCodes = useMemo(() => new Set(specialties.map((item) => item.code)), [specialties])
  const currentYear = new Date().getUTCFullYear()
  const hasValidTrajectoryYear =
    draft.practice_started_year >= 1900 && draft.practice_started_year <= currentYear
  const previewExperienceYears = hasValidTrajectoryYear
    ? currentYear - draft.practice_started_year
    : undefined

  function changeDraft(next: ProfessionalProfilePut) {
    setDraft(next)
    if (remoteError) {
      setRemoteError(undefined)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current) return
    const validation = validateProfile(draft, publishedCodes)
    setErrors(validation)
    setRemoteError(undefined)
    if (hasErrors(validation)) return
    submissionLock.current = true
    const payload = {
      headline: draft.headline.trim(),
      bio: draft.bio.trim(),
      practice_started_year: draft.practice_started_year,
      specialty_codes: draft.specialty_codes,
    }
    const command = commandIntent.commandFor({
      operation: 'profile:update',
      resourceId: profile?.id ?? null,
      payload,
    })
    try {
      const saved = await saveMutation.mutateAsync({ payload, command })
      onSaved(saved)
      setDraft(profileDraft(saved))
      commandIntent.reset()
      toast.success('Tu presentación profesional quedó actualizada.')
    } catch (error) {
      if (isStudioQuerySessionCancelled(error)) {
        commandIntent.reset()
        return
      }
      if (onSessionFailure(error)) {
        commandIntent.reset()
        return
      }
      if (error instanceof StudioApiError && error.status === 503) {
        setRemoteError(
          'El servicio no está disponible. Reintenta para continuar la misma operación.',
        )
      } else if (error instanceof StudioApiError && error.status === 422) {
        setRemoteError('El servicio rechazó uno de los valores. Revisa los campos marcados.')
        setErrors(validateProfile(draft, publishedCodes))
      } else {
        setRemoteError('No pudimos guardar tu presentación.')
      }
    } finally {
      submissionLock.current = false
    }
  }

  return (
    <div data-profile-presentation>
      <Card data-profile-editor>
        <CardHeader>
          <CardTitle>{profile ? 'Edita tu presentación' : 'Crea tu presentación'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.headline)}>
                <FieldLabel htmlFor="profile-headline">Titular profesional</FieldLabel>
                <Input
                  id="profile-headline"
                  value={draft.headline}
                  maxLength={120}
                  aria-invalid={Boolean(errors.headline)}
                  aria-describedby="profile-headline-help profile-headline-error"
                  onChange={(event) => changeDraft({ ...draft, headline: event.target.value })}
                />
                <FieldDescription id="profile-headline-help">
                  Una frase clara sobre tus servicios. {draft.headline.length}/120
                </FieldDescription>
                <FieldError id="profile-headline-error">{errors.headline}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.bio)}>
                <FieldLabel htmlFor="profile-bio">Biografía</FieldLabel>
                <Textarea
                  id="profile-bio"
                  value={draft.bio}
                  maxLength={2000}
                  rows={7}
                  aria-invalid={Boolean(errors.bio)}
                  aria-describedby="profile-bio-help profile-bio-error"
                  onChange={(event) => changeDraft({ ...draft, bio: event.target.value })}
                />
                <FieldDescription id="profile-bio-help">
                  Explica tu enfoque, experiencia y forma de acompañar. {draft.bio.length}/2.000
                </FieldDescription>
                <FieldError id="profile-bio-error">{errors.bio}</FieldError>
              </Field>

              <div data-profile-field-grid>
                <Field data-invalid={Boolean(errors.practice_started_year)}>
                  <FieldLabel htmlFor="profile-started-year">
                    Año en que comenzaste a ejercer
                  </FieldLabel>
                  <Input
                    id="profile-started-year"
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={currentYear}
                    value={draft.practice_started_year || ''}
                    aria-invalid={Boolean(errors.practice_started_year)}
                    onChange={(event) =>
                      changeDraft({ ...draft, practice_started_year: Number(event.target.value) })
                    }
                  />
                  <FieldError>{errors.practice_started_year}</FieldError>
                </Field>

                <Field data-invalid={Boolean(errors.specialty_codes)}>
                  <FieldLabel htmlFor="profile-specialties">Especialidades</FieldLabel>
                  <Combobox<SpecialtyOption, true>
                    items={options}
                    itemToStringLabel={(item) => item.name}
                    multiple
                    value={selectedOptions}
                    onValueChange={(value) =>
                      changeDraft({ ...draft, specialty_codes: value.map((item) => item.code) })
                    }
                  >
                    <ComboboxInputGroup>
                      <ComboboxChips>
                        <ComboboxValue>
                          {(value: SpecialtyOption[]) => (
                            <>
                              {value.map((item) => (
                                <ComboboxChip key={item.code}>
                                  {item.name}
                                  {!item.available ? ' · No disponible' : ''}
                                  <ComboboxChipRemove aria-label={`Retirar ${item.name}`} />
                                </ComboboxChip>
                              ))}
                              <ComboboxChipsInput
                                id="profile-specialties"
                                placeholder={value.length === 0 ? 'Busca especialidades' : ''}
                                aria-invalid={Boolean(errors.specialty_codes)}
                              />
                            </>
                          )}
                        </ComboboxValue>
                      </ComboboxChips>
                      <ComboboxActions>
                        <ComboboxTrigger aria-label="Abrir especialidades" />
                      </ComboboxActions>
                    </ComboboxInputGroup>
                    <ComboboxContent>
                      <ComboboxStatus />
                      <ComboboxEmpty>No encontramos esa especialidad.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: SpecialtyOption) => (
                          <ComboboxItem key={item.code} value={item} disabled={!item.available}>
                            <span data-profile-combobox-option>
                              <strong>{item.name}</strong>
                              <small>{item.available ? item.description : 'No disponible'}</small>
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>Elige entre 1 y 50 especialidades.</FieldDescription>
                  <FieldError>{errors.specialty_codes}</FieldError>
                </Field>
              </div>
            </FieldGroup>

            {remoteError ? (
              <Alert variant="danger" live="assertive">
                <AlertTitle>No pudimos guardar</AlertTitle>
                <AlertDescription>{remoteError}</AlertDescription>
              </Alert>
            ) : null}

            <div data-profile-form-actions>
              <Button type="submit" size="lg" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Spinner label="Guardando presentación" /> : null}
                {saveMutation.isPending
                  ? 'Guardando…'
                  : profile
                    ? 'Guardar cambios'
                    : 'Crear mi perfil'}
              </Button>
              <p>Tu perfil no cambia roles, permisos ni membresías.</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card
        data-trajectory-panel
        data-trajectory-state={profile ? 'active' : 'preview'}
        aria-label="Trayectoria profesional"
      >
        <CardHeader>
          <CardTitle>{profile ? 'Trayectoria declarada' : 'Vista previa'}</CardTitle>
        </CardHeader>
        <CardContent data-trajectory-body>
          <StatStrip>
            <StatStripItem
              label={profile ? 'Comenzaste a ejercer en' : 'Año de inicio'}
              value={hasValidTrajectoryYear ? draft.practice_started_year : '—'}
            />
            <StatStripItem
              label={profile ? 'Hoy' : 'Experiencia calculada'}
              value={
                previewExperienceYears === undefined
                  ? '—'
                  : `${previewExperienceYears} ${previewExperienceYears === 1 ? 'año' : 'años'}`
              }
            />
          </StatStrip>
          <p>
            {profile
              ? 'Los años se derivan del año en que comenzaste y se actualizan automáticamente.'
              : 'Esta línea se activa cuando guardas tu perfil. Nada se publica mientras completas el formulario.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function profileDraft(profile: ProfessionalProfile | null): ProfessionalProfilePut {
  return profile
    ? {
        headline: profile.headline,
        bio: profile.bio,
        practice_started_year: profile.practice_started_year,
        specialty_codes: profile.specialties.map((item) => item.code),
      }
    : {
        headline: '',
        bio: '',
        practice_started_year: 0,
        specialty_codes: [],
      }
}
