'use client'

/**
 * `HU-BO-021` — verifying a professional credential.
 *
 * Four decisions shape this screen, and none of them is layout.
 *
 * **There is no default result.** The three outcomes are offered side by side and
 * none is selected. The decision is not sent until one is chosen, because a missing
 * answer must never read as a pass.
 *
 * **There is nowhere to attach a document.** A verifier checks the official
 * registry or the issuer and writes down what the source said. The screen has no
 * upload and no preview, so a copy cannot end up stored by accident.
 *
 * **The validity is a consequence.** There is no field for it. The screen says what
 * it will be — at most twelve months, sooner if the source expires sooner — because
 * the server derives it and a verifier cannot ask for longer.
 *
 * **A conflict is stated before anyone tries.** When the verifier is the holder or
 * shares an active gym with them, the card says so and offers no decision.
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
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
} from '@/lib/backoffice-api'
import {
  RENEWAL_OPENED,
  VERIFICATION_METHODS,
  VERIFICATION_RESULTS,
  conflictSentence,
  decisionIssue,
  decisionIssueMessage,
  decisionSuccess,
  draftFor,
  formatDay,
  kindLabel,
  methodHint,
  methodLabel,
  previousSentence,
  renewalSentence,
  resultExplanation,
  resultLabel,
  toDecision,
  validitySentence,
  verificationMessage,
  type CredentialRenewalDue,
  type CredentialVerificationMethod,
  type CredentialVerificationRequest,
  type VerificationDraft,
} from '@/lib/credential-verification'

type LoadState = 'loading' | 'ready' | 'failed'

export function CredentialVerification() {
  const [state, setState] = useState<LoadState>('loading')
  const [requests, setRequests] = useState<CredentialVerificationRequest[]>([])
  const [renewals, setRenewals] = useState<CredentialRenewalDue[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<VerificationDraft | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [queue, due] = await Promise.all([
        backofficeApi.verificationRequests(signal),
        backofficeApi.verificationRenewals(signal),
      ])
      setRequests(queue.items)
      setRenewals(due.items)
      setState('ready')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(failureMessage(caught))
      setState('failed')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function open(request: CredentialVerificationRequest) {
    setActiveId(request.request_id)
    setDraft(draftFor(request))
    setIssue(null)
    setNotice(null)
  }

  function close() {
    setActiveId(null)
    setDraft(null)
    setIssue(null)
  }

  function update<K extends keyof VerificationDraft>(field: K, value: VerificationDraft[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
  }

  async function submit(event: FormEvent, request: CredentialVerificationRequest) {
    event.preventDefault()
    if (!draft) return
    const broken = decisionIssue(draft)
    if (broken || !draft.result) {
      setIssue(decisionIssueMessage(broken ?? 'result'))
      return
    }
    setIssue(null)
    setBusy(true)
    setNotice(null)
    try {
      const outcome = await backofficeApi.decideVerification(
        toDecision(request.request_id, draft.result, draft),
        newBackofficeCommand(),
      )
      close()
      await load()
      setNotice({ tone: 'success', message: decisionSuccess(outcome) })
    } catch (caught) {
      setNotice({ tone: 'danger', message: failureMessage(caught) })
      // A request decided elsewhere is stale on screen; reading again removes it.
      if (caught instanceof BackofficeApiError && caught.code === 'conflict') {
        close()
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  async function renew(due: CredentialRenewalDue) {
    setBusy(true)
    setNotice(null)
    try {
      await backofficeApi.openVerificationRenewal(due.credential_id, newBackofficeCommand())
      await load()
      setNotice({ tone: 'success', message: RENEWAL_OPENED })
    } catch (caught) {
      setNotice({ tone: 'danger', message: failureMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <Spinner />

  if (state === 'failed') {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo leer la cola de verificación</AlertTitle>
        <AlertDescription>
          {failure ?? verificationMessage('upstream-unavailable')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-credential-verification>
      {notice ? (
        <Alert live="polite" variant={notice.tone === 'success' ? 'success' : 'danger'}>
          <AlertTitle>{notice.tone === 'success' ? 'Hecho' : 'No se aplicó'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Títulos por verificar
          </CardTitle>
          <CardDescription>
            Cada solicitud es una versión exacta de un título. Se verifica contra el registro
            oficial de la profesión o con quien lo emitió; aquí no se sube ni se guarda ningún
            documento.
          </CardDescription>
        </CardHeader>
      </Card>

      {requests.length === 0 ? (
        <Alert live="off" variant="info">
          <AlertTitle>No hay títulos esperando verificación</AlertTitle>
          <AlertDescription>
            Cuando alguien declare o corrija un título aparecerá aquí, sin que tenga que pedirlo.
          </AlertDescription>
        </Alert>
      ) : (
        requests.map((request) => {
          const previous = previousSentence(request)
          const editing = activeId === request.request_id && draft !== null
          return (
            <Card key={request.request_id} data-verification-request>
              <CardHeader>
                <CardTitle role="heading" aria-level={3}>
                  {request.credential_type_name} · {request.credential_name}
                </CardTitle>
                <CardDescription>
                  {request.holder_given_name} {request.holder_family_name}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`vr-kind-${request.request_id}`}>Solicitud</FieldLabel>
                    <Badge id={`vr-kind-${request.request_id}`} variant="secondary">
                      {kindLabel(request.kind)}
                    </Badge>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`vr-issuer-${request.request_id}`}>Emisor</FieldLabel>
                    <span id={`vr-issuer-${request.request_id}`}>{request.issuer}</span>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`vr-identifier-${request.request_id}`}>
                      Identificador
                    </FieldLabel>
                    <code id={`vr-identifier-${request.request_id}`}>
                      {request.credential_identifier ?? 'Sin identificador declarado'}
                    </code>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`vr-dates-${request.request_id}`}>
                      Fechas declaradas
                    </FieldLabel>
                    <span id={`vr-dates-${request.request_id}`}>
                      Expedido: {request.issued_on ?? 'sin fecha'} · Vence:{' '}
                      {request.expires_on ?? 'sin fecha'}
                    </span>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor={`vr-where-${request.request_id}`}>
                      Dónde verificar
                    </FieldLabel>
                    <span id={`vr-where-${request.request_id}`}>
                      {methodLabel(request.suggested_method)}.{' '}
                      {methodHint(request.suggested_method)}
                    </span>
                  </Field>
                </FieldGroup>

                {/* A plain anchor, not a Button rendered as one: opening the registry is
                    navigation, and the Button primitive exposes its element as a button. */}
                {request.verification_url ? (
                  <a
                    data-verification-registry-link
                    href={request.verification_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir el registro
                  </a>
                ) : null}

                {previous ? (
                  <Alert live="off" variant="info">
                    <AlertTitle>Renueva una verificación anterior</AlertTitle>
                    <AlertDescription>{previous}</AlertDescription>
                  </Alert>
                ) : null}

                {!request.viewer_can_decide ? (
                  <Alert live="off" variant="warning" data-verification-conflict>
                    <AlertTitle>Conflicto de interés</AlertTitle>
                    <AlertDescription>{conflictSentence()}</AlertDescription>
                  </Alert>
                ) : editing ? (
                  <form
                    onSubmit={(event) => void submit(event, request)}
                    data-verification-form
                    noValidate
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="vr-result">Resultado</FieldLabel>
                        <span id="vr-result" data-verification-choice>
                          {VERIFICATION_RESULTS.map((result) => {
                            const selected = draft.result === result
                            return (
                              <Button
                                key={result}
                                type="button"
                                aria-pressed={selected}
                                disabled={busy}
                                onClick={() => update('result', result)}
                                {...(selected ? {} : { variant: 'outline' as const })}
                              >
                                {resultLabel(result)}
                              </Button>
                            )
                          })}
                        </span>
                        {draft.result ? (
                          <span data-verification-explanation>
                            {resultExplanation(draft.result)}
                          </span>
                        ) : null}
                      </Field>

                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-method">Cómo lo verificaste</FieldLabel>
                        <Select
                          value={draft.method}
                          onValueChange={(next) =>
                            update('method', (next ?? draft.method) as CredentialVerificationMethod)
                          }
                        >
                          <SelectTrigger id="vr-method" disabled={busy}>
                            <SelectValue>{methodLabel(draft.method)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {VERIFICATION_METHODS.map((method) => (
                              <SelectItem key={method} value={method}>
                                {methodLabel(method)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-authority">Autoridad consultada</FieldLabel>
                        <Input
                          id="vr-authority"
                          value={draft.sourceAuthority}
                          onChange={(event) => update('sourceAuthority', event.target.value)}
                          autoComplete="off"
                          disabled={busy}
                        />
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-jurisdiction">Jurisdicción</FieldLabel>
                        <Input
                          id="vr-jurisdiction"
                          value={draft.sourceJurisdiction}
                          onChange={(event) => update('sourceJurisdiction', event.target.value)}
                          placeholder="CO"
                          autoComplete="off"
                          disabled={busy}
                        />
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-reference">Referencia en la fuente</FieldLabel>
                        <Input
                          id="vr-reference"
                          value={draft.sourceReference}
                          onChange={(event) => update('sourceReference', event.target.value)}
                          autoComplete="off"
                          disabled={busy}
                        />
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-status">Lo que dijo la fuente</FieldLabel>
                        <Input
                          id="vr-status"
                          value={draft.sourceStatus}
                          onChange={(event) => update('sourceStatus', event.target.value)}
                          placeholder="Vigente"
                          autoComplete="off"
                          disabled={busy}
                        />
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-checked">Consultado el</FieldLabel>
                        <Input
                          id="vr-checked"
                          type="datetime-local"
                          value={draft.sourceCheckedAt}
                          onChange={(event) => update('sourceCheckedAt', event.target.value)}
                          disabled={busy}
                        />
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vr-source-valid-to">
                          La fuente dice que vence
                        </FieldLabel>
                        <Input
                          id="vr-source-valid-to"
                          type="datetime-local"
                          value={draft.sourceValidTo}
                          onChange={(event) => update('sourceValidTo', event.target.value)}
                          disabled={busy}
                        />
                      </Field>

                      <Alert live="off" variant="info" data-verification-validity>
                        <AlertTitle>La vigencia no se elige</AlertTitle>
                        <AlertDescription>{validitySentence()}</AlertDescription>
                      </Alert>

                      {issue ? <FieldError>{issue}</FieldError> : null}
                      <Button type="submit" disabled={busy}>
                        Registrar decisión
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={close}>
                        Cancelar
                      </Button>
                    </FieldGroup>
                  </form>
                ) : (
                  <Button type="button" disabled={busy} onClick={() => open(request)}>
                    Decidir
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Verificaciones por vencer
          </CardTitle>
          <CardDescription>
            Títulos verificados cuya vigencia termina en menos de 30 días o ya terminó. Renovar abre
            una solicitud nueva; la verificación anterior queda como estaba.
          </CardDescription>
        </CardHeader>
      </Card>

      {renewals.length === 0 ? (
        <Alert live="off" variant="info">
          <AlertTitle>Ninguna verificación por vencer</AlertTitle>
          <AlertDescription>
            Cuando una vigencia esté por terminar aparecerá aquí, para abrir su renovación a tiempo.
          </AlertDescription>
        </Alert>
      ) : (
        renewals.map((due) => (
          <Card key={due.credential_id} data-verification-renewal>
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>
                {due.credential_type_name} · {due.credential_name}
              </CardTitle>
              <CardDescription>
                {due.holder_given_name} {due.holder_family_name} · {due.issuer}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert live="off" variant="warning">
                <AlertTitle>{renewalSentence(due)}</AlertTitle>
                <AlertDescription>
                  Verificado hasta el {formatDay(due.last_valid_to)}. Hay que rehacerla: no se
                  extiende.
                </AlertDescription>
              </Alert>
              <Button type="button" disabled={busy} onClick={() => void renew(due)}>
                Abrir renovación
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return verificationMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return verificationMessage(error.code)
  return verificationMessage('upstream-unavailable')
}
