'use client'

/**
 * `HU-BO-011` — resending a gym's client invitations from its file.
 *
 * Three decisions shape it.
 *
 * **The button is the database's answer.** A row offers a resend only when the API
 * says it is resendable, and otherwise says why not. Guessing here would offer
 * something the command refuses, and a missing button with no reason reads like a bug.
 *
 * **What the invitation asked for is shown, always.** This is an offer over someone's
 * health data. An operator who cannot see what is being asked cannot tell whether
 * resending it is the right thing to do.
 *
 * **A lost answer never sends a second email.** Each invitation keeps the command it
 * was first resent with until an answer arrives, so retrying after a network failure
 * replays the same command instead of mailing the person again.
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
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeClientInvitation,
  type BackofficeClientInvitationResend,
  type BackofficeCommand,
} from '@/lib/backoffice-api'
import {
  clientInvitationStateLabel,
  clientInvitationStateTone,
  clientInvitationsMessage,
  issuedByLabel,
  notResendableReason,
  offerLabel,
  resendFailureMessage,
  resendOutcomeMessage,
} from '@/lib/organization-client-invitations'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'failed'

export function OrganizationClientInvitations({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [items, setItems] = useState<BackofficeClientInvitation[]>([])
  const [truncated, setTruncated] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<BackofficeClientInvitationResend | null>(null)
  const [resendFailure, setResendFailure] = useState<string | null>(null)
  const pending = useRef(new Map<string, BackofficeCommand>())

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const list = await backofficeApi.organizationClientInvitations(
          organizationId,
          controller.signal,
        )
        setItems(list.items)
        setTruncated(list.truncated)
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(listFailure(error))
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [organizationId, reload])

  async function resend(invitation: BackofficeClientInvitation) {
    const command = pending.current.get(invitation.invitation_id) ?? newBackofficeCommand()
    pending.current.set(invitation.invitation_id, command)
    setBusy(invitation.invitation_id)
    setOutcome(null)
    setResendFailure(null)
    try {
      const result = await backofficeApi.resendClientInvitation(
        organizationId,
        invitation.invitation_id,
        command,
      )
      pending.current.delete(invitation.invitation_id)
      setOutcome(result)
      setReload((value) => value + 1)
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      if (error instanceof BackofficeNetworkError) {
        // The command may have landed; keep it so the retry replays instead of resending.
        setResendFailure(resendFailureMessage('network-unavailable'))
        return
      }
      const code = error instanceof BackofficeApiError ? error.code : 'unknown'
      if (code !== 'idempotency-in-progress') pending.current.delete(invitation.invitation_id)
      setResendFailure(resendFailureMessage(code))
      if (code === 'conflict') setReload((value) => value + 1)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card data-client-invitations>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Invitaciones de cliente
        </CardTitle>
        <CardDescription>
          Reenviar nunca cambia a quién va, el gimnasio ni los permisos que pide. Una invitación
          vigente sale igual y su primer correo sigue sirviendo; una vencida se reemplaza por una
          nueva que firma Allfit y que pide exactamente lo mismo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === 'loading' ? <Spinner /> : null}

        {state === 'failed' ? (
          <Alert live="polite" variant="warning">
            <AlertTitle>No se pudieron leer las invitaciones</AlertTitle>
            <AlertDescription>
              {failure ?? clientInvitationsMessage('upstream-unavailable')}
            </AlertDescription>
          </Alert>
        ) : null}

        {outcome ? (
          <Alert live="polite" variant="success" data-client-invitation-outcome>
            <AlertTitle>
              {outcome.outcome === 'redelivered'
                ? 'Invitación reenviada'
                : 'Invitación reemplazada'}
            </AlertTitle>
            <AlertDescription>{resendOutcomeMessage(outcome)}</AlertDescription>
          </Alert>
        ) : null}

        {resendFailure ? (
          <Alert live="assertive" variant="danger" data-client-invitation-failure>
            <AlertTitle>No se reenvió</AlertTitle>
            <AlertDescription>{resendFailure}</AlertDescription>
          </Alert>
        ) : null}

        {state === 'ready' && items.length === 0 ? (
          <span data-client-invitations-empty>
            Este gimnasio no ha invitado a nadie como cliente.
          </span>
        ) : null}

        {state === 'ready' && items.length > 0 ? (
          <Table scrollAreaLabel="Invitaciones de cliente">
            <TableHeader>
              <TableRow>
                <TableHead>Para</TableHead>
                <TableHead>Pide</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Firmada por</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Último reenvío</TableHead>
                <TableHead>Reenviar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((invitation) => (
                <TableRow
                  key={invitation.invitation_id}
                  data-client-invitation
                  data-state={invitation.state}
                >
                  <TableCell>
                    <code>{invitation.contact_hint}</code>
                  </TableCell>
                  <TableCell data-client-invitation-offer>{offerLabel(invitation)}</TableCell>
                  <TableCell>
                    <Badge variant={clientInvitationStateTone(invitation.state)}>
                      {clientInvitationStateLabel(invitation.state)}
                    </Badge>
                  </TableCell>
                  <TableCell>{issuedByLabel(invitation)}</TableCell>
                  <TableCell>{formatInstant(invitation.expires_at)}</TableCell>
                  <TableCell>
                    {invitation.last_resent_at ? formatInstant(invitation.last_resent_at) : '—'}
                  </TableCell>
                  <TableCell>
                    {invitation.resendable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        aria-label={`Reenviar la invitación de cliente a ${invitation.contact_hint}`}
                        onClick={() => void resend(invitation)}
                      >
                        {busy === invitation.invitation_id ? 'Reenviando…' : 'Reenviar'}
                      </Button>
                    ) : (
                      <span data-client-invitation-reason>{notResendableReason(invitation)}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {truncated ? (
          <span data-client-invitations-truncated>
            Se muestran las 50 invitaciones más recientes.
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}

function listFailure(error: unknown): string {
  if (error instanceof BackofficeNetworkError)
    return clientInvitationsMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return clientInvitationsMessage(error.code)
  return clientInvitationsMessage('upstream-unavailable')
}
