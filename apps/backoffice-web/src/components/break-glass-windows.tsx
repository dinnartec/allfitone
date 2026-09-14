'use client'

/**
 * `HU-BO-008` — the exceptional path.
 *
 * Four decisions shape this screen, and none of them is layout.
 *
 * **The tier is a consequence, not a field.** The operator picks categories and
 * the screen says what that costs: one approver and thirty minutes, or two
 * distinct approvers and fifteen. There is no control for the tier, the approval
 * count or the duration, so nobody can go looking for the cheap combination.
 *
 * **Forbidden categories are absent.** Not disabled, not annotated — they do not
 * appear. An option that can never be granted is an invitation to try.
 *
 * **A window says how long it has left.** Fifteen minutes is short and
 * "approved" alone does not tell anyone to hurry. There is no extend button
 * because there is no extension.
 *
 * **A denied attempt is shown as a recorded fact, not an error.** The evidence is
 * the point: the operator sees which reason was written, and the person whose data
 * it was sees the same attempt in their own audit trail.
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
import { Checkbox } from '@allfitone/react/components/checkbox'
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
  type BreakGlassRequest,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  BREAK_GLASS_CATEGORIES,
  BREAK_GLASS_PURPOSES,
  approvalsSoFar,
  breakGlassMessage,
  canDecide,
  canExercise,
  categoryLabel,
  outcomeMessage,
  purposeLabel,
  quorumSentence,
  requestIssue,
  requestIssueMessage,
  statusLabel,
  statusTone,
  tierConsequence,
  tierLabel,
  windowSentence,
  type BreakGlassCategory,
  type BreakGlassExerciseOutcome,
  type BreakGlassPurpose,
} from '@/lib/break-glass'

type LoadState = 'loading' | 'ready' | 'failed'

export function BreakGlassWindows() {
  const [state, setState] = useState<LoadState>('loading')
  const [files, setFiles] = useState<BreakGlassRequest[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [subject, setSubject] = useState('')
  const [caseReference, setCaseReference] = useState('')
  const [purpose, setPurpose] = useState<BreakGlassPurpose>('customer_support_request')
  const [categories, setCategories] = useState<BreakGlassCategory[]>([])
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<BreakGlassExerciseOutcome | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const read = await backofficeApi.breakGlassRequests({}, signal)
      setFiles(read.items)
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

  // A window is minutes long, so the countdown has to move without an interaction:
  // an operator watching the screen has to see it lapse rather than find out by
  // clicking. When it reaches zero the read is no longer offered — that is what
  // closing itself means here, since there is no extension to offer instead.
  const hasOpenWindow = files.some(
    (file) => file.status === 'approved' && file.window_ends_at !== null,
  )
  useEffect(() => {
    if (!hasOpenWindow) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasOpenWindow])

  const consequence = tierConsequence(categories)

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true)
    setNotice(null)
    try {
      await operation()
      await load()
      setNotice({ tone: 'success', message: success })
    } catch (caught) {
      setNotice({ tone: 'danger', message: failureMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const broken = requestIssue({ subject, caseReference, categories })
    if (broken) {
      setError(requestIssueMessage(broken))
      return
    }
    setError(null)
    await run(
      () =>
        backofficeApi.requestBreakGlass(
          {
            subject_person_id: subject.trim(),
            categories,
            purpose,
            case_reference: caseReference.trim(),
          },
          newBackofficeCommand(),
        ),
      'Solicitud abierta. Necesita aprobación de otra persona antes de abrir la ventana.',
    )
    setCategories([])
  }

  async function exercise(file: BreakGlassRequest, category: BreakGlassCategory) {
    setBusy(true)
    setNotice(null)
    setOutcome(null)
    try {
      // Every attempt is recorded before this answers, so the outcome is shown as
      // a fact rather than as a failure.
      const answer = await backofficeApi.exerciseBreakGlass(file.id, {
        category,
        resource_type: 'execution.executed_sessions',
      })
      setOutcome(answer)
      await load()
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
        <AlertTitle>No se pudo leer la bandeja</AlertTitle>
        <AlertDescription>{failure ?? breakGlassMessage('upstream-unavailable')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-break-glass>
      {notice ? (
        <Alert live="polite" variant={notice.tone === 'success' ? 'success' : 'danger'}>
          <AlertTitle>{notice.tone === 'success' ? 'Hecho' : 'No se aplicó'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {outcome ? (
        <Alert
          live="assertive"
          variant={outcome.outcome === 'denied' ? 'warning' : 'info'}
          data-break-glass-outcome
        >
          <AlertTitle>
            {outcome.outcome === 'denied' ? 'Intento denegado y registrado' : 'Intento registrado'}
          </AlertTitle>
          <AlertDescription>
            {outcomeMessage(outcome)} La persona verá este intento en su propio registro de accesos,
            con la hora exacta.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Pedir una ventana excepcional
          </CardTitle>
          <CardDescription>
            Sólo cuando el estado operativo no alcanza. Otra persona tiene que aprobarla, la ventana
            dura minutos y cada lectura queda registrada para la persona afectada. No existe acceso
            a «toda la cuenta» ni extensión de una ventana.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-break-glass-form noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="bg-subject">Persona afectada</FieldLabel>
                <Input
                  id="bg-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="019a8000-0000-7000-8000-000000000006"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="bg-case">Referencia del caso</FieldLabel>
                <Input
                  id="bg-case"
                  value={caseReference}
                  onChange={(event) => setCaseReference(event.target.value)}
                  placeholder="CASE-2026-001"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="bg-purpose">Propósito</FieldLabel>
                <Select
                  value={purpose}
                  onValueChange={(next) =>
                    setPurpose((next ?? 'customer_support_request') as BreakGlassPurpose)
                  }
                >
                  <SelectTrigger id="bg-purpose" disabled={busy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BREAK_GLASS_PURPOSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {purposeLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="bg-categories">Qué necesitas ver</FieldLabel>
                <span id="bg-categories" data-break-glass-categories>
                  {BREAK_GLASS_CATEGORIES.map((category) => (
                    <Checkbox
                      key={category}
                      checked={categories.includes(category)}
                      onCheckedChange={(checked) =>
                        setCategories((current) =>
                          checked === true
                            ? [...current, category]
                            : current.filter((kept) => kept !== category),
                        )
                      }
                      disabled={busy}
                      aria-label={categoryLabel(category)}
                    >
                      {categoryLabel(category)}
                    </Checkbox>
                  ))}
                </span>
              </Field>

              {consequence ? (
                <Alert live="polite" variant="info" data-break-glass-consequence>
                  <AlertTitle>Alcance {tierLabel(consequence.tier).toLowerCase()}</AlertTitle>
                  <AlertDescription>
                    {consequence.sentence} Eso lo decide el servidor a partir de lo que elegiste; no
                    se puede pedir otro.
                  </AlertDescription>
                </Alert>
              ) : null}

              {error ? <FieldError>{error}</FieldError> : null}
              <Button type="submit" disabled={busy}>
                Pedir la ventana
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {files.length === 0 ? (
        <Alert live="off" variant="info">
          <AlertTitle>No hay expedientes</AlertTitle>
          <AlertDescription>
            Aquí aparecerán las solicitudes que tengas que decidir y las tuyas, con su quórum, su
            ventana y cuántas veces se ejerció.
          </AlertDescription>
        </Alert>
      ) : (
        files.map((file) => (
          <Card key={file.id} data-break-glass-file>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                {file.case_reference} · {purposeLabel(file.purpose)}
              </CardTitle>
              <CardDescription>
                {file.categories.map((category) => categoryLabel(category)).join(' · ')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="responsive">
                  <FieldLabel htmlFor={`bg-status-${file.id}`}>Estado</FieldLabel>
                  <Badge id={`bg-status-${file.id}`} variant={statusTone(file.status)}>
                    {statusLabel(file.status)}
                  </Badge>
                </Field>
                <Field orientation="responsive">
                  <FieldLabel htmlFor={`bg-tier-${file.id}`}>Alcance</FieldLabel>
                  <span id={`bg-tier-${file.id}`}>
                    {tierLabel(file.sensitivity_tier)} · {file.required_approvals}{' '}
                    {file.required_approvals === 1 ? 'aprobación' : 'aprobaciones'} ·{' '}
                    {file.requested_duration_minutes} minutos
                  </span>
                </Field>
                <Field orientation="responsive">
                  <FieldLabel htmlFor={`bg-subject-${file.id}`}>Persona afectada</FieldLabel>
                  <code id={`bg-subject-${file.id}`}>{file.subject_person_id}</code>
                </Field>
                <Field orientation="responsive">
                  <FieldLabel htmlFor={`bg-exercises-${file.id}`}>Veces ejercida</FieldLabel>
                  <span id={`bg-exercises-${file.id}`}>{file.exercise_count}</span>
                </Field>
              </FieldGroup>

              {file.status === 'requested' ? (
                <Alert live="off" variant="warning">
                  <AlertTitle>{quorumSentence(file)}</AlertTitle>
                  <AlertDescription>
                    Vence el {formatInstant(file.request_expires_at)} si nadie decide. Ninguna
                    aprobación parcial abre la ventana.
                  </AlertDescription>
                </Alert>
              ) : null}

              {windowSentence(file, now) ? (
                <Alert
                  live="off"
                  variant={canExercise(file, now) ? 'success' : 'warning'}
                  data-break-glass-window
                >
                  <AlertTitle>{windowSentence(file, now)}</AlertTitle>
                  <AlertDescription>
                    Cierra el {formatInstant(file.window_ends_at)}. Para continuar después hay que
                    pedir otra ventana.
                  </AlertDescription>
                </Alert>
              ) : null}

              {file.approvals.length > 0 ? (
                <FieldGroup>
                  {file.approvals.map((approval) => (
                    <Field key={approval.approver_person_id} orientation="responsive">
                      <FieldLabel htmlFor={`bg-approval-${approval.approver_person_id}`}>
                        {approval.decision === 'approved' ? 'Aprobó' : 'Rechazó'}
                      </FieldLabel>
                      <span id={`bg-approval-${approval.approver_person_id}`}>
                        <code>{approval.approver_person_id}</code> ·{' '}
                        {formatInstant(approval.decided_at)}
                      </span>
                    </Field>
                  ))}
                </FieldGroup>
              ) : null}

              {canDecide(file) ? (
                <FieldGroup>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          backofficeApi.decideBreakGlass(
                            file.id,
                            { decision: 'approved', reason_code: 'REASON-APPROVED' },
                            newBackofficeCommand(),
                          ),
                        approvalsSoFar(file) + 1 >= file.required_approvals
                          ? 'Aprobada. La ventana quedó abierta.'
                          : 'Aprobada. Falta otra persona para que la ventana se abra.',
                      )
                    }
                  >
                    Aprobar
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          backofficeApi.decideBreakGlass(
                            file.id,
                            { decision: 'rejected', reason_code: 'REASON-REJECTED' },
                            newBackofficeCommand(),
                          ),
                        'Rechazada. El rechazo es definitivo: no se puede aprobar después.',
                      )
                    }
                  >
                    Rechazar
                  </Button>
                </FieldGroup>
              ) : null}

              {canExercise(file, now) ? (
                <FieldGroup>
                  {file.categories.map((category) => (
                    <Button
                      key={category}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void exercise(file, category)}
                    >
                      Leer {categoryLabel(category).toLowerCase()}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => backofficeApi.closeBreakGlass(file.id, newBackofficeCommand()),
                        'Ventana cerrada. Ninguna lectura entrega contenido desde ahora.',
                      )
                    }
                  >
                    Cerrar la ventana
                  </Button>
                </FieldGroup>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return breakGlassMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return breakGlassMessage(error.code)
  return breakGlassMessage('upstream-unavailable')
}
