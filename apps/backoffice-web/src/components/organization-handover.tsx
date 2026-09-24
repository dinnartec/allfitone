'use client'

/**
 * `HU-BO-014` and `HU-BO-015` — where a handover stands, and the only two things
 * Allfit may do while it waits.
 *
 * **Waiting is not done.** The badge and the sentence say whether the owner has not
 * answered, let the invitation lapse, rejected it, accepted it, or whether the
 * creation was cancelled. Only the first three allow any action.
 *
 * **Neither action changes the address.** Resending goes to the same email, and the
 * screen says whether the original invitation was sent again or replaced.
 * Cancelling asks once more before it happens, because it cannot be undone.
 *
 * **A lost race is re-read, not guessed.** If the owner accepted or someone else
 * cancelled meanwhile, the command is refused and the screen reads the handover
 * again rather than showing a state it no longer has.
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
import { Spinner } from '@allfitone/react/components/spinner'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type OrganizationHandover as Handover,
} from '@/lib/backoffice-api'
import {
  CANCELLED_NOTICE,
  canActOn,
  handoverMessage,
  handoverStage,
  resendNotice,
  responsibleSentence,
  stageLabel,
  stageSentence,
  stageTone,
} from '@/lib/organization-handover'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'failed'
type Notice = { tone: 'success' | 'danger'; message: string }

export function OrganizationHandover({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState<LoadState>('loading')
  const [handover, setHandover] = useState<Handover | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await backofficeApi.organizationHandover(organizationId, signal)
        setHandover(next)
        setNow(Date.now())
        setState('ready')
      } catch (caught) {
        if (signal?.aborted) return
        if (caught instanceof BackofficeApiError && caught.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(failureMessage(caught))
        setState('failed')
      }
    },
    [organizationId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function run(action: 'resend' | 'cancel') {
    if (!handover) return
    const stageBefore = handoverStage(handover, now)
    setBusy(true)
    setNotice(null)
    try {
      const next =
        action === 'resend'
          ? await backofficeApi.resendOrganizationHandover(organizationId, newBackofficeCommand())
          : await backofficeApi.cancelOrganizationHandover(organizationId, newBackofficeCommand())
      setHandover(next)
      setNow(Date.now())
      setConfirming(false)
      setNotice({
        tone: 'success',
        message: action === 'resend' ? resendNotice(stageBefore) : CANCELLED_NOTICE,
      })
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setNotice({ tone: 'danger', message: failureMessage(caught) })
      setConfirming(false)
      if (caught instanceof BackofficeApiError && caught.code === 'conflict') await load()
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <Spinner />

  if (state === 'failed' || !handover) {
    return (
      <div data-organization-handover>
        <Alert live="assertive" variant="danger">
          <AlertTitle>No se pudo leer la entrega</AlertTitle>
          <AlertDescription>{failure ?? handoverMessage('upstream-unavailable')}</AlertDescription>
        </Alert>
        <Link href="/organizations" data-handover-link>
          Volver al directorio
        </Link>
      </div>
    )
  }

  const stage = handoverStage(handover, now)
  const invitation = handover.invitation

  return (
    <div data-organization-handover data-stage={stage}>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {handover.display_name}
          </CardTitle>
          <CardDescription>{handover.type_name}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert
            live="polite"
            variant={stage === 'claimed' ? 'success' : 'info'}
            data-handover-stage
          >
            <AlertTitle>
              <Badge variant={stageTone(stage)}>{stageLabel(stage)}</Badge>
            </AlertTitle>
            <AlertDescription>{stageSentence(handover, stage)}</AlertDescription>
          </Alert>

          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="ho-responsible">Quién responde</FieldLabel>
              <span id="ho-responsible">{responsibleSentence(handover)}</span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="ho-site-view">Sede</FieldLabel>
              <span id="ho-site-view">
                {handover.site
                  ? [handover.site.name, handover.site.address].filter(Boolean).join(' · ')
                  : 'Sin sede declarada'}
              </span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="ho-invited">Invitación enviada a</FieldLabel>
              <code id="ho-invited">{invitation?.contact_hint ?? '—'}</code>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="ho-created">Creado</FieldLabel>
              <span id="ho-created">{formatInstant(handover.created_at)}</span>
            </Field>
          </FieldGroup>

          {canActOn(stage) ? (
            confirming ? (
              <Alert live="assertive" variant="warning" data-handover-confirm>
                <AlertTitle>¿Cancelar la creación?</AlertTitle>
                <AlertDescription>
                  El gimnasio queda cancelado y su invitación retirada. Nadie podrá reclamarlo y no
                  se puede deshacer.
                </AlertDescription>
                <span data-handover-actions>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void run('cancel')}
                  >
                    {busy ? 'Cancelando…' : 'Sí, cancelar la creación'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    No, dejarlo como está
                  </Button>
                </span>
              </Alert>
            ) : (
              <span data-handover-actions>
                <Button type="button" disabled={busy} onClick={() => void run('resend')}>
                  {busy ? 'Enviando…' : 'Enviar la invitación de nuevo'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Cancelar la creación
                </Button>
              </span>
            )
          ) : null}
        </CardContent>
      </Card>

      {notice ? (
        <Alert live={notice.tone === 'danger' ? 'assertive' : 'polite'} variant={notice.tone}>
          <AlertTitle>
            {notice.tone === 'danger' ? 'No se completó la operación' : 'Listo'}
          </AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
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
