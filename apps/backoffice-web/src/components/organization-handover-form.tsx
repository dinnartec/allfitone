'use client'

/**
 * `HU-BO-014` — creating a gym for a sale and inviting its owner.
 *
 * Three decisions, and none of them is layout.
 *
 * **No field asks for a person's name.** Choosing a natural person hides the legal
 * name instead of leaving it empty, and says why: the name arrives with their own
 * account when they accept.
 *
 * **The button says what happens.** It creates and invites in one step, and the
 * screen says up front that the gym will not operate until its owner accepts, so
 * nobody reads "created" as "handed over".
 *
 * **A retry is the same command.** The command identifiers are kept while the form
 * does not change, so a timeout followed by a second click converges on one gym
 * instead of creating two.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeCommand,
} from '@/lib/backoffice-api'
import {
  EMPTY_HANDOVER_DRAFT,
  ORGANIZATION_TYPES,
  PARTY_KINDS,
  handoverDraftIssue,
  handoverDraftIssueMessage,
  handoverMessage,
  partyKindExplanation,
  toHandoverCreate,
  type HandoverDraft,
  type OrganizationTypeCode,
} from '@/lib/organization-handover'

export function OrganizationHandoverForm() {
  const router = useRouter()
  const [draft, setDraft] = useState<HandoverDraft>(EMPTY_HANDOVER_DRAFT)
  const [issue, setIssue] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ body: string; command: BackofficeCommand } | null>(null)

  function update<K extends keyof HandoverDraft>(field: K, value: HandoverDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const broken = handoverDraftIssue(draft)
    if (broken) {
      setIssue(handoverDraftIssueMessage(broken))
      return
    }
    setIssue(null)
    setFailure(null)
    const create = toHandoverCreate(draft)
    const body = JSON.stringify(create)
    // The same form is the same command: a retry converges instead of creating twice.
    if (pending.current?.body !== body) pending.current = { body, command: newBackofficeCommand() }
    setBusy(true)
    try {
      const handover = await backofficeApi.createOrganizationHandover(
        create,
        pending.current.command,
      )
      pending.current = null
      router.push(`/organizations/${handover.organization_id}/handover`)
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(failureMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-organization-handover-form>
      <Alert live="off" variant="info">
        <AlertTitle>Crear no es entregar</AlertTitle>
        <AlertDescription>
          El gimnasio queda creado pero no opera hasta que su dueño acepte la invitación. Allfit no
          lo administra mientras tanto y no crea las cuentas de su equipo: el dueño las invita desde
          Studio.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Crear un gimnasio y entregárselo a su dueño
          </CardTitle>
          <CardDescription>
            Para una venta asistida. La invitación va a un correo, nunca a una cuenta elegida desde
            aquí.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} data-handover-form noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="ho-name">Nombre del gimnasio</FieldLabel>
                <Input
                  id="ho-name"
                  value={draft.displayName}
                  onChange={(event) => update('displayName', event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="ho-type">Tipo</FieldLabel>
                <Select
                  value={draft.typeCode}
                  onValueChange={(next) => update('typeCode', (next ?? '') as OrganizationTypeCode)}
                >
                  <SelectTrigger id="ho-type" disabled={busy}>
                    <SelectValue placeholder="Elige el tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORGANIZATION_TYPES.map((type) => (
                      <SelectItem key={type.code} value={type.code}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="ho-party">Quién responde por el gimnasio</FieldLabel>
                <span id="ho-party" data-handover-choice>
                  {PARTY_KINDS.map((kind) => {
                    const selected = draft.partyKind === kind.code
                    return (
                      <Button
                        key={kind.code}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => update('partyKind', kind.code)}
                        {...(selected ? {} : { variant: 'outline' as const })}
                      >
                        {kind.label}
                      </Button>
                    )
                  })}
                </span>
                {draft.partyKind ? (
                  <span data-handover-party-explanation>
                    {partyKindExplanation(draft.partyKind)}
                  </span>
                ) : null}
              </Field>

              {draft.partyKind === 'legal_entity' ? (
                <Field orientation="responsive">
                  <FieldLabel htmlFor="ho-legal">Razón social</FieldLabel>
                  <Input
                    id="ho-legal"
                    value={draft.legalName}
                    onChange={(event) => update('legalName', event.target.value)}
                    maxLength={160}
                    autoComplete="off"
                    disabled={busy}
                  />
                </Field>
              ) : null}

              <Field orientation="responsive">
                <FieldLabel htmlFor="ho-site">Sede (opcional)</FieldLabel>
                <Input
                  id="ho-site"
                  value={draft.siteName}
                  onChange={(event) => update('siteName', event.target.value)}
                  placeholder="Sede principal"
                  maxLength={120}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="ho-address">Dirección de la sede (opcional)</FieldLabel>
                <Input
                  id="ho-address"
                  value={draft.siteAddress}
                  onChange={(event) => update('siteAddress', event.target.value)}
                  maxLength={240}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="ho-email">Correo de quien será el dueño</FieldLabel>
                <Input
                  id="ho-email"
                  type="email"
                  value={draft.ownerEmail}
                  onChange={(event) => update('ownerEmail', event.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              {issue ? <FieldError>{issue}</FieldError> : null}
              <Button type="submit" disabled={busy}>
                {busy ? 'Creando…' : 'Crear y enviar la invitación'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {failure ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>No se pudo crear el gimnasio</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      <Link href="/organizations" data-handover-link>
        Volver al directorio
      </Link>
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return handoverMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return handoverMessage(error.code)
  return handoverMessage('upstream-unavailable')
}
