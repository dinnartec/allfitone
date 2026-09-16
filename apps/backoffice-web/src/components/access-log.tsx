'use client'

/**
 * `HU-BO-030` — who from the team looked at whose data.
 *
 * Four decisions, and none of them is layout.
 *
 * **An incomplete answer never looks complete.** The server removes the records
 * belonging to break-glass windows this auditor requested or approved, and says
 * how many. The screen states that number next to the list, including — especially
 * — when the list is empty. An auditor who cannot see it reports "nobody looked"
 * when somebody did, and it was them.
 *
 * **The log is not browsed.** It answers a question, so the screen asks for the
 * filter first and refuses an unfiltered query. Reading the whole log is not
 * auditing; it is looking through other people's access records, every one of
 * which is about a real person.
 *
 * **An exceptional access is not one row among many.** Break-glass is the row an
 * auditor is usually looking for, and it carries the basis for the read spelled
 * out rather than an enum name.
 *
 * **The record is not the content.** The log says somebody read
 * `nutrition.intake_entries`; it cannot say what they saw. The screen says so, so
 * nobody goes hunting for a detail view that does not and should not exist.
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
import { Spinner } from '@allfitone/react/components/spinner'
import { useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type AccessEventPage,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  EMPTY_FILTERS,
  accessLogMessage,
  answerSentence,
  filterIssue,
  filterIssueMessage,
  hasWithheld,
  isExceptional,
  modeBasis,
  modeLabel,
  modeTone,
  resultLabel,
  toQuery,
  type AccessLogFilters,
} from '@/lib/access-log'

type LoadState = 'idle' | 'loading' | 'ready' | 'failed'

export function AccessLog() {
  const [state, setState] = useState<LoadState>('idle')
  const [page, setPage] = useState<AccessEventPage | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [filters, setFilters] = useState<AccessLogFilters>(EMPTY_FILTERS)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const broken = filterIssue(filters)
    if (broken) {
      setError(filterIssueMessage(broken))
      return
    }
    setError(null)
    setState('loading')
    try {
      setPage(await backofficeApi.accessEvents(toQuery(filters)))
      setState('ready')
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(failureMessage(caught))
      setState('failed')
    }
  }

  function update(field: keyof AccessLogFilters, value: string) {
    setFilters((current) => ({ ...current, [field]: value }))
  }

  return (
    <div data-access-log>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Consultar el registro de accesos
          </CardTitle>
          <CardDescription>
            Quién del equipo miró los datos de quién, y cuándo. Muestra el registro del acceso,
            nunca lo que se leyó: eso no se guarda y no se puede recuperar desde aquí. El registro
            no se edita ni se borra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-access-log-filters noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="al-actor">Integrante del equipo</FieldLabel>
                <Input
                  id="al-actor"
                  value={filters.actorPersonId}
                  onChange={(event) => update('actorPersonId', event.target.value)}
                  placeholder="019a9000-0000-7000-8000-000000000004"
                  autoComplete="off"
                  disabled={state === 'loading'}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="al-subject">Persona afectada</FieldLabel>
                <Input
                  id="al-subject"
                  value={filters.subjectPersonId}
                  onChange={(event) => update('subjectPersonId', event.target.value)}
                  placeholder="019a9000-0000-7000-8000-000000000006"
                  autoComplete="off"
                  disabled={state === 'loading'}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="al-from">Desde</FieldLabel>
                <Input
                  id="al-from"
                  type="datetime-local"
                  value={filters.from}
                  onChange={(event) => update('from', event.target.value)}
                  disabled={state === 'loading'}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="al-to">Hasta</FieldLabel>
                <Input
                  id="al-to"
                  type="datetime-local"
                  value={filters.to}
                  onChange={(event) => update('to', event.target.value)}
                  disabled={state === 'loading'}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Button type="submit" disabled={state === 'loading'}>
                Consultar
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {state === 'loading' ? <Spinner /> : null}

      {state === 'failed' ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>No se pudo consultar el registro</AlertTitle>
          <AlertDescription>{failure ?? accessLogMessage('upstream-unavailable')}</AlertDescription>
        </Alert>
      ) : null}

      {state === 'ready' && page ? (
        <>
          {/* The whole answer, withheld records included, before any row. */}
          <Alert
            live="polite"
            variant={hasWithheld(page) ? 'warning' : 'info'}
            data-access-log-answer
          >
            <AlertTitle>
              {hasWithheld(page) ? 'Esta respuesta está incompleta' : 'Resultado de la consulta'}
            </AlertTitle>
            <AlertDescription>{answerSentence(page)}</AlertDescription>
          </Alert>

          {page.items.map((event) => (
            <Card
              key={`${event.occurred_at}-${event.actor_person_id}-${event.resource}`}
              data-access-log-entry
              data-exceptional={isExceptional(event) ? 'true' : 'false'}
            >
              <CardHeader>
                <CardTitle role="heading" aria-level={3}>
                  {event.resource}
                </CardTitle>
                <CardDescription>{formatInstant(event.occurred_at)}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`al-mode-${event.occurred_at}`}>
                      Base del acceso
                    </FieldLabel>
                    <Badge
                      id={`al-mode-${event.occurred_at}`}
                      variant={modeTone(event.access_mode)}
                    >
                      {modeLabel(event.access_mode)}
                    </Badge>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`al-actor-${event.occurred_at}`}>Quién accedió</FieldLabel>
                    <code id={`al-actor-${event.occurred_at}`}>{event.actor_person_id}</code>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`al-subject-${event.occurred_at}`}>Sobre quién</FieldLabel>
                    <code id={`al-subject-${event.occurred_at}`}>
                      {event.subject_person_id ?? 'Sin persona afectada'}
                    </code>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`al-result-${event.occurred_at}`}>Resultado</FieldLabel>
                    <span id={`al-result-${event.occurred_at}`}>{resultLabel(event.result)}</span>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`al-purpose-${event.occurred_at}`}>Propósito</FieldLabel>
                    <span id={`al-purpose-${event.occurred_at}`}>{event.purpose}</span>
                  </Field>
                  {event.scope_code ? (
                    <Field orientation="responsive">
                      <FieldLabel htmlFor={`al-scope-${event.occurred_at}`}>Permiso</FieldLabel>
                      <span id={`al-scope-${event.occurred_at}`}>
                        {event.scope_code} · v{event.scope_version}
                      </span>
                    </Field>
                  ) : null}
                </FieldGroup>

                <Alert live="off" variant={isExceptional(event) ? 'warning' : 'info'}>
                  <AlertTitle>Qué autorizó esta lectura</AlertTitle>
                  <AlertDescription>{modeBasis(event.access_mode)}</AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return accessLogMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return accessLogMessage(error.code)
  return accessLogMessage('upstream-unavailable')
}
