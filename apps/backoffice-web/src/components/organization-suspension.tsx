'use client'

/**
 * `HU-BO-016` — stopping a gym, from the gym's own file.
 *
 * **The panel spends more words on what suspending does not do than on what it does.**
 * The word invites the reader to imagine deletion, and the command does the opposite.
 * An operator who believes they are destroying something will either refuse to use
 * this or use it expecting a destruction that never comes.
 *
 * **The cost is on screen while the reason is being picked.** How many people stop
 * being served is what makes the decision real, and it is a different number for
 * every gym.
 *
 * **Reactivating is drawn as subtractive.** It closes this suspension's causes and
 * recomputes; it restores nothing. Saying "restore" here would promise a rollback the
 * platform cannot perform and should not.
 *
 * **A lost answer never decides twice.** The command is kept until an answer arrives,
 * so retrying after a network failure replays it rather than stopping a gym twice.
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
import { Field, FieldGroup, FieldLabel } from '@allfitone/react/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { useRef, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeCommand,
  type OrganizationSuspension as Suspension,
  type OrganizationSuspensionReason,
} from '@/lib/backoffice-api'
import {
  SUSPENSION_REASONS,
  WHAT_REACTIVATING_DOES,
  WHAT_SUSPENDING_DOES,
  WHAT_SUSPENDING_DOES_NOT_DO,
  blockedSentence,
  costWarning,
  periodSentence,
  reasonLabel,
  stateSentence,
  suspensionMessage,
  suspensionOutcomeMessage,
} from '@/lib/organization-suspension'
import { formatInstant } from '@/lib/platform-access'

export function OrganizationSuspensionPanel({
  suspension: initial,
  peopleServed,
}: {
  suspension: Suspension
  peopleServed: number
}) {
  const [suspension, setSuspension] = useState<Suspension>(initial)
  const [reason, setReason] = useState<OrganizationSuspensionReason>('nonpayment')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const pending = useRef<BackofficeCommand | null>(null)

  async function run(action: 'suspend' | 'reactivate') {
    const command = pending.current ?? newBackofficeCommand()
    pending.current = command
    setBusy(true)
    setFailure(null)
    setOutcome(null)
    try {
      const saved =
        action === 'suspend'
          ? await backofficeApi.suspendOrganization(suspension.organization_id, reason, command)
          : await backofficeApi.reactivateOrganization(suspension.organization_id, command)
      pending.current = null
      setSuspension(saved)
      setOutcome(suspensionOutcomeMessage(saved))
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(
        error instanceof BackofficeNetworkError
          ? suspensionMessage('network-unavailable')
          : suspensionMessage(error instanceof BackofficeApiError ? error.code : 'unknown'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-suspension-panel>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          Suspensión
        </CardTitle>
        <CardDescription>
          Cortarle el servicio a un gimnasio sin destruir nada. Es reversible y no es lo mismo que
          cancelar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p data-suspension-state>
          {stateSentence(suspension)}{' '}
          {suspension.suspended ? <Badge variant="destructive">Suspendido</Badge> : null}
        </p>
        {suspension.current ? (
          <>
            <p data-suspension-blocked>{blockedSentence(suspension)}</p>
            <p data-suspension-since>Desde {formatInstant(suspension.current.started_at)}.</p>
          </>
        ) : null}

        <p data-suspension-does>{WHAT_SUSPENDING_DOES}</p>
        <p data-suspension-does-not>{WHAT_SUSPENDING_DOES_NOT_DO}</p>

        {suspension.suspended ? (
          <div data-suspension-reactivate-form>
            <p data-suspension-reactivate-note>{WHAT_REACTIVATING_DOES}</p>
            <Button
              type="button"
              disabled={busy}
              data-suspension-reactivate
              onClick={() => void run('reactivate')}
            >
              {busy ? 'Guardando…' : 'Levantar la suspensión'}
            </Button>
          </div>
        ) : (
          <FieldGroup data-suspension-form>
            <Field>
              <FieldLabel htmlFor="suspension-reason">Motivo</FieldLabel>
              <Select
                value={reason}
                onValueChange={(next) =>
                  setReason((next ?? reason) as OrganizationSuspensionReason)
                }
              >
                <SelectTrigger id="suspension-reason" disabled={busy}>
                  <SelectValue>{reasonLabel(reason)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUSPENSION_REASONS.map((code) => (
                    <SelectItem key={code} value={code}>
                      {reasonLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Alert live="polite" variant="warning" data-suspension-cost>
              <AlertTitle>Lo que cuesta esta decisión</AlertTitle>
              <AlertDescription>{costWarning(peopleServed)}</AlertDescription>
            </Alert>
            <Button
              type="button"
              disabled={busy}
              data-suspension-save
              onClick={() => void run('suspend')}
            >
              {busy ? 'Guardando…' : 'Suspender el gimnasio'}
            </Button>
          </FieldGroup>
        )}

        {suspension.history.length > 0 ? (
          <ul data-suspension-history>
            {suspension.history.map((period) => (
              <li key={period.suspension_id} data-suspension-period>
                {periodSentence(period)} · {formatInstant(period.started_at)}
                {period.ended_at ? ` – ${formatInstant(period.ended_at)}` : ''}
              </li>
            ))}
          </ul>
        ) : null}

        {outcome ? (
          <Alert live="polite" variant="success" data-suspension-outcome>
            <AlertTitle>Estado cambiado</AlertTitle>
            <AlertDescription>{outcome}</AlertDescription>
          </Alert>
        ) : null}

        {failure ? (
          <Alert live="assertive" variant="danger" data-suspension-failure>
            <AlertTitle>No se pudo cambiar</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
