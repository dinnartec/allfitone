'use client'

/**
 * `HU-BO-010` — sending a person the official recovery flow from their card.
 *
 * Three decisions shape it.
 *
 * **Nothing here edits the person.** There is no field for a name, an email or a phone:
 * only actions that start the person's own flow, recorded against the case of the card.
 *
 * **The buttons are the database's answer.** Starting, resending and cancelling appear
 * only when the API says they apply. When recovery is unavailable the card says so and
 * offers no alternative, because V1 has none.
 *
 * **A lost answer never sends a second email.** Each action keeps its command until an
 * answer arrives, so retrying after a network failure replays instead of mailing again.
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
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { useEffect, useRef, useState } from 'react'

import {
  recoveryCommandMessage,
  recoveryOutcomeMessage,
  recoveryStateExplanation,
  recoveryStateLabel,
  recoveryStateTone,
  recoveryUnavailableMessage,
  accountRecoveryMessage,
  type RecoveryAction,
} from '@/lib/account-recovery'
import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeAccountRecovery,
  type BackofficeAccountRecoveryRequest,
  type BackofficeCommand,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'failed'

export function AccountRecoveryPanel({
  personId,
  caseReference,
}: {
  personId: string
  caseReference: string
}) {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<BackofficeAccountRecovery | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [commandFailure, setCommandFailure] = useState<string | null>(null)
  const pending = useRef(new Map<string, BackofficeCommand>())

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setRecovery(await backofficeApi.accountRecovery(personId, caseReference, controller.signal))
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(readFailure(error))
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [personId, caseReference, reload])

  async function run(
    key: string,
    action: RecoveryAction,
    send: (command: BackofficeCommand) => Promise<BackofficeAccountRecoveryRequest>,
  ) {
    const command = pending.current.get(key) ?? newBackofficeCommand()
    pending.current.set(key, command)
    setBusy(key)
    setConfirmingCancel(null)
    setOutcome(null)
    setCommandFailure(null)
    try {
      const result = await send(command)
      pending.current.delete(key)
      setOutcome(recoveryOutcomeMessage(action, result))
      setReload((value) => value + 1)
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      if (error instanceof BackofficeNetworkError) {
        // The command may have landed; keep it so the retry replays instead of resending.
        setCommandFailure(recoveryCommandMessage('network-unavailable'))
        return
      }
      const code = error instanceof BackofficeApiError ? error.code : 'unknown'
      if (code !== 'idempotency-in-progress') pending.current.delete(key)
      setCommandFailure(recoveryCommandMessage(code))
      if (code === 'conflict') setReload((value) => value + 1)
    } finally {
      setBusy(null)
    }
  }

  const start = () =>
    run('start', 'start', (command) =>
      backofficeApi.startAccountRecovery(personId, caseReference, command),
    )
  const resend = (request: BackofficeAccountRecoveryRequest) =>
    run(`resend:${request.request_id}`, 'resend', (command) =>
      backofficeApi.resendAccountRecovery(personId, request.request_id, caseReference, command),
    )
  const cancel = (request: BackofficeAccountRecoveryRequest) =>
    run(`cancel:${request.request_id}`, 'cancel', (command) =>
      backofficeApi.cancelAccountRecovery(personId, request.request_id, caseReference, command),
    )

  const requests = recovery?.requests ?? []
  const underWay = requests.some((request) => request.cancellable)

  return (
    <Card data-account-recovery>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Recuperación de acceso
        </CardTitle>
        <CardDescription>
          Desde aquí no se edita ningún dato de la persona. Si todavía puede entrar, cambia su
          nombre, correo o teléfono desde Allfit Space y confirma de nuevo su identidad. Si no puede
          entrar, puedes enviarle el flujo oficial de recuperación al correo que ya verificó: un
          enlace temporal, de un solo uso, que solo ella puede usar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === 'loading' ? <Spinner /> : null}

        {state === 'failed' ? (
          <Alert live="polite" variant="warning">
            <AlertTitle>No se pudo leer la recuperación</AlertTitle>
            <AlertDescription>
              {failure ?? accountRecoveryMessage('upstream-unavailable')}
            </AlertDescription>
          </Alert>
        ) : null}

        {outcome ? (
          <Alert live="polite" variant="success" data-account-recovery-outcome>
            <AlertTitle>Listo</AlertTitle>
            <AlertDescription>{outcome}</AlertDescription>
          </Alert>
        ) : null}

        {commandFailure ? (
          <Alert live="assertive" variant="danger" data-account-recovery-failure>
            <AlertTitle>No se completó</AlertTitle>
            <AlertDescription>{commandFailure}</AlertDescription>
          </Alert>
        ) : null}

        {state === 'ready' && recovery?.availability === 'unavailable' ? (
          <Alert live="polite" variant="warning" data-account-recovery-unavailable>
            <AlertTitle>Recuperación no disponible</AlertTitle>
            <AlertDescription>
              {recoveryUnavailableMessage(recovery.unavailable_reason)}
            </AlertDescription>
          </Alert>
        ) : null}

        {state === 'ready' && recovery?.can_start ? (
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => void start()}
            data-account-recovery-start
          >
            {busy === 'start'
              ? 'Enviando…'
              : `Enviar la recuperación a ${recovery.contact_hint ?? 'su correo verificado'}`}
          </Button>
        ) : null}

        {state === 'ready' &&
        recovery?.availability === 'available' &&
        !recovery.can_start &&
        !underWay ? (
          <span data-account-recovery-self>
            No puedes iniciar la recuperación de tu propia cuenta: la pide otra persona del equipo.
          </span>
        ) : null}

        {state === 'ready' && requests.length === 0 ? (
          <span data-account-recovery-empty>
            No se ha iniciado ninguna recuperación para esta persona.
          </span>
        ) : null}

        {state === 'ready' && requests.length > 0 ? (
          <Table scrollAreaLabel="Recuperaciones de acceso">
            <TableHeader>
              <TableRow>
                <TableHead>Estado</TableHead>
                <TableHead>Enviada a</TableHead>
                <TableHead>Inicio</TableHead>
                <TableHead>Envíos</TableHead>
                <TableHead>Qué pasó</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow
                  key={request.request_id}
                  data-account-recovery-request
                  data-state={request.state}
                >
                  <TableCell>
                    <Badge variant={recoveryStateTone(request.state)}>
                      {recoveryStateLabel(request.state)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code>{request.contact_hint}</code>
                  </TableCell>
                  <TableCell>
                    {formatInstant(request.created_at)} · caso {request.case_reference}
                  </TableCell>
                  <TableCell>{request.send_count}</TableCell>
                  <TableCell>{recoveryStateExplanation(request)}</TableCell>
                  <TableCell>
                    {confirmingCancel === request.request_id ? (
                      <div data-account-recovery-confirm>
                        <span>¿Cancelarla? Si el correo ya salió, no se puede retirar.</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy !== null}
                          onClick={() => void cancel(request)}
                        >
                          Sí, cancelar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmingCancel(null)}
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <RequestActions
                        request={request}
                        busy={busy}
                        onResend={() => void resend(request)}
                        onCancel={() => setConfirmingCancel(request.request_id)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RequestActions({
  request,
  busy,
  onResend,
  onCancel,
}: {
  request: BackofficeAccountRecoveryRequest
  busy: string | null
  onResend: () => void
  onCancel: () => void
}) {
  if (!request.resendable && !request.cancellable) return <span>—</span>
  return (
    <div data-account-recovery-actions>
      {request.resendable ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          aria-label={`Reenviar la recuperación a ${request.contact_hint}`}
          onClick={onResend}
        >
          {busy === `resend:${request.request_id}` ? 'Reenviando…' : 'Reenviar'}
        </Button>
      ) : null}
      {request.cancellable ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          aria-label={`Cancelar la recuperación enviada a ${request.contact_hint}`}
          onClick={onCancel}
        >
          Cancelar
        </Button>
      ) : null}
    </div>
  )
}

function readFailure(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return accountRecoveryMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return accountRecoveryMessage(error.code)
  return accountRecoveryMessage('upstream-unavailable')
}
