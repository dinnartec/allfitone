'use client'

/**
 * `HU-BO-006` — finding a person to help them.
 *
 * Three things about this screen are rules rather than layout.
 *
 * The case reference is asked for first and lives in the URL, so a reload does
 * not lose it and the operator can see exactly what is being recorded next to
 * every query they run. It is not a formality: the server records the search
 * against it, and a read nobody can trace back to a case is what `PR-22` exists
 * to prevent.
 *
 * There is no free text field. The lookup kind is chosen from a closed list,
 * because searching by name does not exist — not as a disabled option, not as a
 * feature waiting for permission.
 *
 * A search that finds nobody says so. The API answers an outcome beside the
 * items precisely so this screen cannot show an unexplained empty list.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
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
import { Spinner } from '@allfitone/react/components/spinner'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type SupportPeopleSearch,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  SUPPORT_LOOKUP_KINDS,
  isValidCaseReference,
  isValidLookup,
  lookupIssueMessage,
  lookupLabel,
  lookupPlaceholder,
  supportMetadataMessage,
  verificationLabel,
  type SupportLookupKind,
} from '@/lib/support-metadata'

export function SupportPeopleSearch() {
  const router = useRouter()
  const parameters = useSearchParams()
  const [caseReference, setCaseReference] = useState(parameters.get('case_reference') ?? '')
  const [kind, setKind] = useState<SupportLookupKind>('email')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SupportPeopleSearch | null>(null)
  const [searched, setSearched] = useState<{ kind: SupportLookupKind } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const reference = caseReference.trim()
    if (!isValidCaseReference(reference)) {
      setError('La referencia del caso va en mayúsculas, como CASE-2026-001.')
      return
    }
    if (!isValidLookup(kind, value)) {
      setError(lookupIssueMessage(kind))
      return
    }

    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const found = await backofficeApi.searchSupportPeople({
        caseReference: reference,
        kind,
        value: value.trim(),
      })
      setResult(found)
      setSearched({ kind })
      // The reference survives a reload and travels to the card, which needs it.
      router.replace(`/people?case_reference=${encodeURIComponent(reference)}`)
    } catch (failure) {
      setResult(null)
      setNotice(failureMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const person = result?.items[0]

  return (
    <div data-support-search>
      {notice ? (
        <Alert live="polite" variant="danger">
          <AlertTitle>No se pudo buscar</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Buscar a una persona
          </CardTitle>
          <CardDescription>
            Sólo por coincidencia exacta de algo que la persona entregó en su caso. No existe
            búsqueda por nombre. Toda búsqueda queda registrada contra la referencia del caso,
            encuentre o no a alguien.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-support-search-form noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-case">Referencia del caso</FieldLabel>
                <Input
                  id="support-case"
                  value={caseReference}
                  onChange={(event) => setCaseReference(event.target.value)}
                  placeholder="CASE-2026-001"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-kind">Buscar por</FieldLabel>
                <Select
                  value={kind}
                  onValueChange={(next) => {
                    setKind((next ?? 'email') as SupportLookupKind)
                    setValue('')
                  }}
                >
                  <SelectTrigger id="support-kind" disabled={busy}>
                    <SelectValue>{lookupLabel(kind)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_LOOKUP_KINDS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {lookupLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-value">Dato exacto</FieldLabel>
                <Input
                  id="support-value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={lookupPlaceholder(kind)}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Button type="submit" disabled={busy}>
                Buscar
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {busy ? <Spinner /> : null}

      {result && result.outcome === 'not_found' && searched ? (
        <Alert live="polite" variant="info">
          <AlertTitle>No hay ninguna persona con ese dato</AlertTitle>
          <AlertDescription>
            La coincidencia es exacta: si la persona escribió el{' '}
            {lookupLabel(searched.kind).toLowerCase().replace(' exacto', '')} de otra forma, no
            aparece. La búsqueda quedó registrada de todos modos.
          </AlertDescription>
        </Alert>
      ) : null}

      {person ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Persona encontrada
            </CardTitle>
            <CardDescription>
              Sólo estado operativo. Para ver el resto, abre su ficha: la consulta queda registrada
              contra el mismo caso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-found-id">Identificador</FieldLabel>
                <code id="support-found-id">{person.person_id}</code>
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-found-status">Estado de la cuenta</FieldLabel>
                <Badge
                  id="support-found-status"
                  variant={person.account_status === 'active' ? 'success' : 'secondary'}
                >
                  {person.account_status}
                </Badge>
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-found-email">Correo</FieldLabel>
                <code id="support-found-email">{person.contact_email_masked ?? 'sin correo'}</code>
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="support-found-verified">Verificación del correo</FieldLabel>
                <span id="support-found-verified">
                  {verificationLabel(person.email_verified_at)}
                  {person.email_verified_at ? ` · ${formatInstant(person.email_verified_at)}` : ''}
                </span>
              </Field>
              <Button
                render={
                  <Link
                    href={`/people/${person.person_id}?case_reference=${encodeURIComponent(caseReference.trim())}`}
                  />
                }
                nativeButton={false}
              >
                Abrir estado operativo
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return supportMetadataMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return supportMetadataMessage(error.code)
  return supportMetadataMessage('upstream-unavailable')
}
