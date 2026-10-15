'use client'

/**
 * `HU-BO-018` — what a person pays, inside her support card.
 *
 * **Its own read and its own duty.** `view_billing_metadata` opens this and the duty
 * that opened the card does not, so the panel loads separately and says which duty is
 * missing when it is refused. Folding it into the card would hand one duty what the
 * other was given.
 *
 * **The failed charge is the one somebody came for.** A complaint about a charge is
 * almost always about the one that did not go through, so a failure carries its reason
 * and is marked, never drawn like a charge that worked.
 *
 * **What Allfit does not charge, it says it does not know.** The plan she pays her gym
 * appears with its state, and the panel states that the charges of that plan are not
 * recorded here. An empty list would read as the gym never having charged her.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Field, FieldGroup, FieldLabel } from '@allfitone/react/components/field'
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { useEffect, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type SupportPersonPayments,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  GYM_CHARGES_NOTE,
  NO_CARD_NOTE,
  bondLine,
  chargeLine,
  paymentsMessage,
  paysNobody,
  proSentence,
  subscriptionPrice,
  subscriptionState,
} from '@/lib/support-payments'

type LoadState = 'loading' | 'ready' | 'failed'

export function SupportPaymentsPanel({
  personId,
  caseReference,
}: {
  personId: string
  caseReference: string
}) {
  const [state, setState] = useState<LoadState>('loading')
  const [payments, setPayments] = useState<SupportPersonPayments | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setPayments(
          await backofficeApi.supportPersonPayments(personId, caseReference, controller.signal),
        )
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        if (error instanceof BackofficeNetworkError) {
          setFailure(paymentsMessage('network-unavailable'))
        } else {
          setFailure(paymentsMessage(error instanceof BackofficeApiError ? error.code : 'unknown'))
        }
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [personId, caseReference])

  if (state === 'loading') return <Spinner />

  if (state === 'failed' || !payments) {
    return (
      <Card data-payments-panel>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Lo que paga
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert live="polite" variant="info" data-payments-refused>
            <AlertTitle>No se puede ver desde aquí</AlertTitle>
            <AlertDescription>{failure ?? paymentsMessage('unknown')}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const subscription = payments.pro.subscription

  return (
    <Card data-payments-panel>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Lo que paga
        </CardTitle>
        <CardDescription>
          {proSentence(payments)} {NO_CARD_NOTE}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subscription ? (
          <FieldGroup data-payments-subscription>
            <Field>
              <FieldLabel htmlFor="payments-plan">Plan</FieldLabel>
              <span id="payments-plan">
                {subscription.plan_name} · versión {subscription.version_number}
              </span>
            </Field>
            <Field>
              <FieldLabel htmlFor="payments-price">Precio</FieldLabel>
              <span id="payments-price">{subscriptionPrice(subscription)}</span>
            </Field>
            <Field>
              <FieldLabel htmlFor="payments-state">Estado</FieldLabel>
              <span id="payments-state" data-payments-state={subscription.status}>
                {subscriptionState(subscription)}
              </span>
            </Field>
          </FieldGroup>
        ) : null}

        {payments.payments.length > 0 ? (
          <Table data-payments-charges>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Qué pasó</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.payments.map((charge) => (
                <TableRow key={`${charge.store}-${charge.occurred_at}`} data-payments-charge>
                  <TableCell>{formatInstant(charge.occurred_at)}</TableCell>
                  <TableCell>
                    {charge.result === 'failed' ? (
                      <Badge variant="destructive">No se cobró</Badge>
                    ) : (
                      <Badge variant="success">Cobrado</Badge>
                    )}{' '}
                    {chargeLine(charge)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {payments.payments_truncated ? (
          <p data-payments-truncated>
            Se muestran los cien cobros más recientes. Hay más antes de estos.
          </p>
        ) : null}

        {payments.organization_subscriptions.length > 0 ? (
          <div data-payments-bonds>
            <h3>Lo que le paga a su gimnasio</h3>
            <ul>
              {payments.organization_subscriptions.map((bond) => (
                <li key={bond.subscription_id} data-payments-bond>
                  <strong>{bond.organization_name}</strong> · {bondLine(bond)}
                </li>
              ))}
            </ul>
            <p data-payments-gym-note>{GYM_CHARGES_NOTE}</p>
          </div>
        ) : null}

        {paysNobody(payments) ? (
          <p data-payments-none>
            Esta persona no le paga nada a nadie en la plataforma. No es que falte el dato: no hay
            ninguna suscripción suya.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
