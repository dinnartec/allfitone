'use client'

/**
 * `OP-SUP-006` — the cases that were used and still owe a review.
 *
 * **This is a debt, drawn as one.** The oldest unreviewed case is at the top and the
 * backlog is counted in the heading, because a reviewer who reads this as an inbox
 * works the newest first and that is the wrong end of a queue of obligations.
 *
 * **An overdue case keeps its buttons.** The deadline makes the delay visible; it does
 * not void the obligation. Greying out a late case would turn a backlog into a
 * permanent hole in the audit, which is the outcome the twenty-four hours exist to
 * prevent.
 *
 * **Each verdict says what it means before it is pressed.** Three buttons that read
 * as a severity scale would make `incident_opened` the angry option; it is not a worse
 * verdict, it is the one that asks somebody to act.
 *
 * **A lost answer never decides twice.** The command is kept until an answer arrives,
 * so a retry after a network failure replays instead of writing a second verdict over
 * a case that already has one.
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
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeCommand,
  type BreakGlassReview,
  type BreakGlassReviewOutcome,
} from '@/lib/backoffice-api'
import {
  LATE_IS_STILL_REQUIRED,
  REVIEW_OUTCOMES,
  WHY_IT_IS_REVIEWED,
  backlogSentence,
  debtSentence,
  dueSentence,
  outcomeLabel,
  outcomeMeaning,
  queueOrder,
  reviewBadge,
  reviewMessage,
  reviewOutcomeMessage,
} from '@/lib/break-glass-review'
import { formatInstant } from '@/lib/platform-access'

export function BreakGlassReviewQueue() {
  const [reviews, setReviews] = useState<BreakGlassReview[] | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pending = useRef(new Map<string, BackofficeCommand>())

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = await backofficeApi.breakGlassReviewQueue(signal)
      setReviews(page.items)
      setRefused(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      setRefused(
        error instanceof BackofficeNetworkError
          ? reviewMessage('network-unavailable')
          : reviewMessage(error instanceof BackofficeApiError ? error.code : 'unknown'),
      )
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function review(requestId: string, verdict: BreakGlassReviewOutcome) {
    const command = pending.current.get(requestId) ?? newBackofficeCommand()
    pending.current.set(requestId, command)
    setBusy(requestId)
    setFailure(null)
    setOutcome(null)
    try {
      const reviewed = await backofficeApi.reviewBreakGlass(requestId, verdict, command)
      pending.current.delete(requestId)
      setReviews((current) =>
        (current ?? []).map((entry) => (entry.request_id === requestId ? reviewed : entry)),
      )
      setOutcome(reviewOutcomeMessage(reviewed))
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(
        error instanceof BackofficeNetworkError
          ? reviewMessage('network-unavailable')
          : reviewMessage(error instanceof BackofficeApiError ? error.code : 'unknown'),
      )
    } finally {
      setBusy(null)
    }
  }

  if (refused) {
    return (
      <Alert live="assertive" variant="danger" data-review-refused>
        <AlertTitle>No se pudo leer la cola de revisión</AlertTitle>
        <AlertDescription>{refused}</AlertDescription>
      </Alert>
    )
  }

  if (reviews === null) return null

  const now = new Date()
  const ordered = queueOrder(reviews)

  return (
    <section data-review-queue>
      <header>
        <h2>Revisión de accesos excepcionales</h2>
        <p data-review-backlog>{backlogSentence(reviews)}</p>
        <p data-review-why>{WHY_IT_IS_REVIEWED}</p>
        <p data-review-late-note>{LATE_IS_STILL_REQUIRED}</p>
      </header>

      {outcome ? (
        <Alert live="polite" variant="success" data-review-outcome>
          <AlertTitle>Revisión registrada</AlertTitle>
          <AlertDescription>{outcome}</AlertDescription>
        </Alert>
      ) : null}

      {failure ? (
        <Alert live="assertive" variant="danger" data-review-failure>
          <AlertTitle>No se pudo registrar</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      {ordered.map((entry) => {
        const badge = reviewBadge(entry)
        return (
          <Card
            key={entry.request_id}
            data-review-case={entry.case_reference}
            data-overdue={String(entry.overdue)}
          >
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>
                {entry.case_reference}
              </CardTitle>
              <CardDescription>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p data-review-debt>{debtSentence(entry, now)}</p>
              <p data-review-due>{dueSentence(entry, now)}</p>
              <p data-review-categories>{entry.categories.join(', ')}</p>

              {entry.reviewed_at === null ? (
                <div data-review-actions>
                  {REVIEW_OUTCOMES.map((verdict) => (
                    <div key={verdict}>
                      <Button
                        type="button"
                        disabled={busy !== null}
                        data-review-verdict={verdict}
                        onClick={() => void review(entry.request_id, verdict)}
                      >
                        {busy === entry.request_id ? 'Guardando…' : outcomeLabel(verdict)}
                      </Button>
                      <p data-review-meaning={verdict}>{outcomeMeaning(verdict)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p data-review-verdict-given>
                  {reviewOutcomeMessage(entry)} {formatInstant(entry.reviewed_at)}.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </section>
  )
}
