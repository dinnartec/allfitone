'use client'

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
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@allfitone/react/components/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@allfitone/react/components/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
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
import { Spinner } from '@allfitone/react/components/spinner'
import { toast } from '@allfitone/react/components/sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { createCommandIntentManager } from '@/lib/command-intent'
import {
  credentialStateLabel,
  credentialStateVariant,
  groupCredentials,
  hasErrors,
  validateCredential,
  type CredentialErrors,
} from '@/lib/professional-profile'
import {
  StudioApiError,
  newCommand,
  studioApi,
  type CommandHeaders,
  type ProfessionalCatalogItem,
  type ProfessionalCredential,
  type ProfessionalCredentialWrite,
  type StudioMe,
} from '@/lib/studio-api'
import { prependCredentialToMe, replaceCredentialInMe, studioQueryKeys } from '@/lib/studio-query'

type CredentialIntent = { kind: 'declare' } | { kind: 'revise'; credential: ProfessionalCredential }
type CredentialMutationVariables = {
  intent: CredentialIntent
  payload: ProfessionalCredentialWrite
  command: CommandHeaders
}

export function ProfessionalCredentials({
  credentials,
  credentialTypes,
  profileExists,
  onCredentialsChange,
  onRefreshMe,
  onSessionFailure,
}: {
  credentials: ProfessionalCredential[]
  credentialTypes: ProfessionalCatalogItem[]
  profileExists: boolean
  onCredentialsChange: (credentials: ProfessionalCredential[]) => void
  onRefreshMe: () => Promise<StudioMe | undefined>
  onSessionFailure: (error: unknown) => boolean
}) {
  const queryClient = useQueryClient()
  const { active, retired } = groupCredentials(credentials)
  const [intent, setIntent] = useState<CredentialIntent>()
  const [retireIntent, setRetireIntent] = useState<{ credential: ProfessionalCredential }>()
  const retirementLock = useRef(false)
  const [retireError, setRetireError] = useState<string>()
  const [retireCommandIntent] = useState(() => createCommandIntentManager(newCommand))
  const retireMutation = useMutation({
    mutationFn: ({ credentialId, command }: { credentialId: string; command: CommandHeaders }) =>
      studioApi.retireProfessionalCredential(credentialId, command),
    onSuccess: (updated) => {
      queryClient.setQueryData<StudioMe>(studioQueryKeys.me(), (current) =>
        replaceCredentialInMe(current, updated),
      )
      void queryClient.invalidateQueries({ queryKey: studioQueryKeys.me(), exact: true })
    },
  })
  const retiring = retireMutation.isPending

  async function retire() {
    if (!retireIntent || retirementLock.current) return
    retirementLock.current = true
    setRetireError(undefined)
    const command = retireCommandIntent.commandFor({
      operation: 'credential:retire',
      resourceId: retireIntent.credential.id,
      payload: null,
    })
    try {
      const updated = await retireMutation.mutateAsync({
        credentialId: retireIntent.credential.id,
        command,
      })
      onCredentialsChange(
        credentials.map((credential) => (credential.id === updated.id ? updated : credential)),
      )
      retireCommandIntent.reset()
      setRetireIntent(undefined)
      toast.success('La credencial pasó al historial.')
    } catch (error) {
      if (onSessionFailure(error)) {
        retireCommandIntent.reset()
        return
      }
      if (error instanceof StudioApiError && (error.status === 404 || error.status === 409)) {
        retireCommandIntent.reset()
        setRetireIntent(undefined)
        await refreshAfterConflict(onRefreshMe)
        toast.warning('La credencial había cambiado. Actualizamos tu perfil.')
      } else if (error instanceof StudioApiError && error.status === 503) {
        setRetireError('El servicio no está disponible. Puedes reintentar la misma operación.')
      } else {
        setRetireError('No pudimos retirar la credencial.')
      }
    } finally {
      retirementLock.current = false
    }
  }

  return (
    <section data-profile-section aria-labelledby="credentials-title">
      <div data-profile-section-heading>
        <div>
          <p data-profile-kicker>Opcional · Personal</p>
          <h2 id="credentials-title">Credenciales profesionales</h2>
          <p>
            No necesitas añadir credenciales para usar Studio. Declara solo las que quieras
            presentar; declarar no significa verificar.
          </p>
        </div>
        <Button onClick={() => setIntent({ kind: 'declare' })} disabled={!profileExists}>
          Añadir credencial
        </Button>
      </div>

      {!profileExists ? (
        <Alert variant="info">
          <AlertTitle>Primero crea tu presentación</AlertTitle>
          <AlertDescription>
            Necesitamos un perfil personal antes de asociar credenciales profesionales.
          </AlertDescription>
        </Alert>
      ) : null}

      {active.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">01</EmptyMedia>
            <EmptyTitle>Aún no has declarado credenciales</EmptyTitle>
            <EmptyDescription>
              Añade una credencial cuando quieras aportar contexto sobre tu formación.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => setIntent({ kind: 'declare' })}
              disabled={!profileExists}
            >
              Declarar la primera
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div data-credential-grid>
          {active.map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              onRevise={() => setIntent({ kind: 'revise', credential })}
              onRetire={() => {
                retireCommandIntent.reset()
                setRetireIntent({ credential })
              }}
            />
          ))}
        </div>
      )}

      {retired.length > 0 ? (
        <Collapsible data-credential-history>
          <CollapsibleTrigger render={<Button variant="ghost" />}>
            Historial retirado · {retired.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div data-credential-grid>
              {retired.map((credential) => (
                <CredentialCard key={credential.id} credential={credential} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <CredentialDialog
        intent={intent}
        credentialTypes={credentialTypes}
        onOpenChange={(open) => {
          if (!open) setIntent(undefined)
        }}
        onSessionFailure={onSessionFailure}
        onDeclared={(credential) => {
          onCredentialsChange([credential, ...credentials])
          setIntent(undefined)
        }}
        onRevised={async () => {
          setIntent(undefined)
          try {
            await onRefreshMe()
          } catch {
            toast.warning('La revisión quedó guardada, pero no pudimos actualizar la vista.')
          }
        }}
        onStale={async () => {
          setIntent(undefined)
          await refreshAfterConflict(onRefreshMe)
        }}
      />

      <AlertDialog
        open={Boolean(retireIntent)}
        onOpenChange={(open) => {
          if (!open && !retiring) {
            retireCommandIntent.reset()
            setRetireIntent(undefined)
            setRetireError(undefined)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Retirar esta credencial?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanecerá en tu historial y dejará de aparecer entre tus credenciales activas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {retireError ? (
            <Alert variant="danger" live="assertive">
              <AlertDescription>{retireError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retiring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={retiring}
              onClick={(event) => {
                event.preventDefault()
                void retire()
              }}
            >
              {retiring ? <Spinner label="Retirando credencial" /> : null}
              {retiring ? 'Retirando…' : 'Retirar credencial'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function CredentialCard({
  credential,
  onRevise,
  onRetire,
}: {
  credential: ProfessionalCredential
  onRevise?: () => void
  onRetire?: () => void
}) {
  return (
    <Card data-credential-card data-retired={credential.status === 'retired'}>
      <CardHeader>
        <div>
          <CardDescription>{credential.credential_type_name}</CardDescription>
          <CardTitle>{credential.name}</CardTitle>
        </div>
        <CardAction>
          <Badge variant={credentialStateVariant(credential)}>
            {credentialStateLabel(credential)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl data-credential-details>
          <div>
            <dt>Emisor</dt>
            <dd>{credential.issuer}</dd>
          </div>
          {credential.identifier ? (
            <div>
              <dt>Identificador</dt>
              <dd>{credential.identifier}</dd>
            </div>
          ) : null}
          <div>
            <dt>Vigencia declarada</dt>
            <dd>{credentialValidity(credential)}</dd>
          </div>
          {credential.verification.valid_from || credential.verification.valid_to ? (
            <div>
              <dt>Vigencia de la verificación</dt>
              <dd>{verificationValidity(credential)}</dd>
            </div>
          ) : null}
        </dl>
        {credential.verification_url ? (
          <a
            data-credential-evidence
            data-slot="button"
            data-variant="link"
            className={buttonVariants({ variant: 'link' })}
            href={credential.verification_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir evidencia declarada
          </a>
        ) : null}
        {onRevise && onRetire ? (
          <div data-credential-actions>
            <Button variant="outline" size="sm" onClick={onRevise}>
              Crear revisión
            </Button>
            <Button variant="ghost" size="sm" onClick={onRetire}>
              Retirar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CredentialDialog({
  intent,
  credentialTypes,
  onOpenChange,
  onDeclared,
  onRevised,
  onStale,
  onSessionFailure,
}: {
  intent: CredentialIntent | undefined
  credentialTypes: ProfessionalCatalogItem[]
  onOpenChange: (open: boolean) => void
  onDeclared: (credential: ProfessionalCredential) => void
  onRevised: () => Promise<void>
  onStale: () => Promise<void>
  onSessionFailure: (error: unknown) => boolean
}) {
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<CredentialErrors>({})
  const [remoteError, setRemoteError] = useState<string>()
  const submissionLock = useRef(false)
  const [commandIntent] = useState(() => createCommandIntentManager(newCommand))
  const credentialMutation = useMutation({
    mutationFn: ({ intent: activeIntent, payload, command }: CredentialMutationVariables) =>
      activeIntent.kind === 'declare'
        ? studioApi.declareProfessionalCredential(payload, command)
        : studioApi.reviseProfessionalCredential(activeIntent.credential.id, payload, command),
    onSuccess: (saved, variables) => {
      if (variables.intent.kind !== 'declare') return
      queryClient.setQueryData<StudioMe>(studioQueryKeys.me(), (current) =>
        prependCredentialToMe(current, saved),
      )
      void queryClient.invalidateQueries({ queryKey: studioQueryKeys.me(), exact: true })
    },
  })
  const submitting = credentialMutation.isPending
  const publishedCodes = new Set(credentialTypes.map((item) => item.code))
  const intentKey = intent
    ? intent.kind === 'declare'
      ? 'declare'
      : `revise:${intent.credential.id}`
    : 'closed'

  useEffect(() => {
    setErrors({})
    setRemoteError(undefined)
    submissionLock.current = false
    commandIntent.reset()
  }, [commandIntent, intentKey])

  return (
    <Dialog open={Boolean(intent)} onOpenChange={onOpenChange} key={intentKey}>
      <DialogContent data-credential-dialog showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {intent?.kind === 'revise' ? 'Crear una revisión' : 'Declarar una credencial'}
          </DialogTitle>
          <DialogDescription>
            {intent?.kind === 'revise'
              ? 'La revisión crea una versión nueva y no hereda la verificación anterior.'
              : 'Registra la información tal como aparece en el documento o la fuente.'}
          </DialogDescription>
        </DialogHeader>
        {intent ? (
          <CredentialForm
            key={intentKey}
            initial={
              intent.kind === 'revise' ? credentialDraft(intent.credential) : emptyCredential()
            }
            credentialTypes={credentialTypes}
            errors={errors}
            remoteError={remoteError}
            submitting={submitting}
            onDraftChange={() => {
              if (remoteError) {
                setRemoteError(undefined)
              }
            }}
            onSubmit={async (value) => {
              const validation = validateCredential(value, publishedCodes)
              setErrors(validation)
              setRemoteError(undefined)
              if (hasErrors(validation) || submissionLock.current) return
              submissionLock.current = true
              const payload = normalizedCredential(value)
              const command = commandIntent.commandFor({
                operation: intent.kind === 'declare' ? 'credential:declare' : 'credential:revise',
                resourceId: intent.kind === 'declare' ? null : intent.credential.id,
                payload,
              })
              try {
                const saved = await credentialMutation.mutateAsync({ intent, payload, command })
                if (intent.kind === 'declare') {
                  commandIntent.reset()
                  onDeclared(saved)
                  toast.success('Credencial declarada como no verificada.')
                } else {
                  commandIntent.reset()
                  await onRevised()
                  toast.success('Creamos una nueva versión de la credencial.')
                }
              } catch (error) {
                if (onSessionFailure(error)) {
                  commandIntent.reset()
                  return
                }
                if (
                  intent.kind === 'revise' &&
                  error instanceof StudioApiError &&
                  (error.status === 404 || error.status === 409)
                ) {
                  commandIntent.reset()
                  await onStale()
                  toast.warning('La credencial había cambiado. Actualizamos tu perfil.')
                } else if (error instanceof StudioApiError && error.status === 503) {
                  setRemoteError(
                    'El servicio no está disponible. Reintenta para continuar la misma operación.',
                  )
                } else if (error instanceof StudioApiError && error.status === 422) {
                  setRemoteError('El servicio rechazó uno de los valores. Revisa el formulario.')
                } else {
                  setRemoteError('No pudimos guardar la credencial.')
                }
              } finally {
                submissionLock.current = false
              }
            }}
          />
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={submitting} />}>
            Cancelar
          </DialogClose>
          <Button form="credential-form" type="submit" disabled={submitting}>
            {submitting ? <Spinner label="Guardando credencial" /> : null}
            {submitting ? 'Guardando…' : intent?.kind === 'revise' ? 'Crear revisión' : 'Declarar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CredentialForm({
  initial,
  credentialTypes,
  errors,
  remoteError,
  submitting,
  onDraftChange,
  onSubmit,
}: {
  initial: ProfessionalCredentialWrite
  credentialTypes: ProfessionalCatalogItem[]
  errors: CredentialErrors
  remoteError: string | undefined
  submitting: boolean
  onDraftChange: () => void
  onSubmit: (draft: ProfessionalCredentialWrite) => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  function update(next: ProfessionalCredentialWrite) {
    setDraft(next)
    onDraftChange()
  }
  return (
    <form
      id="credential-form"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submitting) void onSubmit(draft)
      }}
      noValidate
    >
      <FieldGroup>
        <Field data-invalid={Boolean(errors.credential_type_code)}>
          <FieldLabel htmlFor="credential-type">Tipo</FieldLabel>
          <Select
            value={draft.credential_type_code || null}
            onValueChange={(value) => {
              if (value) update({ ...draft, credential_type_code: value })
            }}
            items={credentialTypes.map((type) => ({ label: type.name, value: type.code }))}
          >
            <SelectTrigger id="credential-type" aria-invalid={Boolean(errors.credential_type_code)}>
              <SelectValue placeholder="Selecciona un tipo" />
            </SelectTrigger>
            <SelectContent>
              {credentialTypes.map((type) => (
                <SelectItem key={type.code} value={type.code}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errors.credential_type_code}</FieldError>
        </Field>
        <div data-profile-field-grid>
          <CredentialTextField
            id="credential-issuer"
            label="Emisor"
            value={draft.issuer}
            maxLength={200}
            error={errors.issuer}
            onChange={(issuer) => update({ ...draft, issuer })}
          />
          <CredentialTextField
            id="credential-name"
            label="Nombre"
            value={draft.name}
            maxLength={200}
            error={errors.name}
            onChange={(name) => update({ ...draft, name })}
          />
        </div>
        <CredentialTextField
          id="credential-identifier"
          label="Identificador"
          value={draft.identifier ?? ''}
          maxLength={160}
          error={errors.identifier}
          optional
          onChange={(identifier) => update({ ...draft, identifier: identifier || null })}
        />
        <div data-profile-field-grid>
          <Field data-invalid={Boolean(errors.issued_on)}>
            <FieldLabel htmlFor="credential-issued-on">Fecha de emisión</FieldLabel>
            <Input
              id="credential-issued-on"
              type="date"
              value={draft.issued_on ?? ''}
              aria-invalid={Boolean(errors.issued_on)}
              onChange={(event) => update({ ...draft, issued_on: event.target.value || null })}
            />
            <FieldError>{errors.issued_on}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.expires_on)}>
            <FieldLabel htmlFor="credential-expires-on">Vigencia hasta</FieldLabel>
            <Input
              id="credential-expires-on"
              type="date"
              value={draft.expires_on ?? ''}
              aria-invalid={Boolean(errors.expires_on)}
              onChange={(event) => update({ ...draft, expires_on: event.target.value || null })}
            />
            <FieldError>{errors.expires_on}</FieldError>
          </Field>
        </div>
        <Field data-invalid={Boolean(errors.verification_url)}>
          <FieldLabel htmlFor="credential-url">URL de evidencia</FieldLabel>
          <Input
            id="credential-url"
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={2048}
            value={draft.verification_url ?? ''}
            aria-invalid={Boolean(errors.verification_url)}
            onChange={(event) => update({ ...draft, verification_url: event.target.value || null })}
          />
          <FieldDescription>Opcional. Solo se aceptan enlaces HTTPS.</FieldDescription>
          <FieldError>{errors.verification_url}</FieldError>
        </Field>
      </FieldGroup>
      {remoteError ? (
        <Alert variant="danger" live="assertive">
          <AlertTitle>No pudimos guardar</AlertTitle>
          <AlertDescription>{remoteError}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}

function CredentialTextField({
  id,
  label,
  value,
  maxLength,
  error,
  optional = false,
  onChange,
}: {
  id: string
  label: string
  value: string
  maxLength: number
  error: string | undefined
  optional?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      {optional ? <FieldDescription>Opcional</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

function emptyCredential(): ProfessionalCredentialWrite {
  return {
    credential_type_code: '',
    issuer: '',
    name: '',
    identifier: null,
    issued_on: null,
    expires_on: null,
    verification_url: null,
  }
}

function credentialDraft(credential: ProfessionalCredential): ProfessionalCredentialWrite {
  return {
    credential_type_code: credential.credential_type_code,
    issuer: credential.issuer,
    name: credential.name,
    identifier: credential.identifier,
    issued_on: credential.issued_on,
    expires_on: credential.expires_on,
    verification_url: credential.verification_url,
  }
}

function normalizedCredential(value: ProfessionalCredentialWrite): ProfessionalCredentialWrite {
  return {
    credential_type_code: value.credential_type_code,
    issuer: value.issuer.trim(),
    name: value.name.trim(),
    identifier: value.identifier?.trim() || null,
    issued_on: value.issued_on || null,
    expires_on: value.expires_on || null,
    verification_url: value.verification_url?.trim() || null,
  }
}

function credentialValidity(credential: ProfessionalCredential): string {
  if (!credential.issued_on && !credential.expires_on) return 'Sin fechas declaradas'
  if (credential.issued_on && credential.expires_on) {
    return `${credential.issued_on} – ${credential.expires_on}`
  }
  if (credential.issued_on) return `Emitida el ${credential.issued_on}`
  return `Vigente hasta ${credential.expires_on}`
}

function verificationValidity(credential: ProfessionalCredential): string {
  const from = credential.verification.valid_from
    ? formatDateTime(credential.verification.valid_from)
    : 'Sin inicio'
  const to = credential.verification.valid_to
    ? formatDateTime(credential.verification.valid_to)
    : 'Sin vencimiento'
  return `${from} – ${to}`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
}

async function refreshAfterConflict(refresh: () => Promise<StudioMe | undefined>): Promise<void> {
  try {
    await refresh()
  } catch {
    toast.error('La credencial cambió y no pudimos refrescar el perfil.')
  }
}
