'use client'

/**
 * `HU-BO-032` — following what people asked us to erase.
 *
 * Three decisions, and none of them is layout.
 *
 * **The panel opens on what is still owed.** A tracking screen that opens on the
 * archive invites reading history instead of finishing work, so the pending half
 * loads first and the resolved half is a deliberate second click.
 *
 * **Late is stated, not implied.** The summary counts how many requests are past
 * the thirty days before any row is drawn, and each row carries the days left
 * rather than a date the reader has to subtract from today.
 *
 * **A suspended category is not a forgotten one.** It reads as held by a legal
 * obligation, because an officer who reads it as pending will try to finish a
 * disposition the law says to keep.
 *
 * The person is an identifier here. This screen tracks the request; reading what
 * the person recorded is a break-glass window, and a different screen.
 *
 * Suspending is offered on the categories that are still waiting, and only those.
 * The form will not let a hold leave without an end date, because there are no
 * indefinite holds and finding that out from the server is finding it out late.
 * Releasing says what it will do before it does it: the erasure continues.
 *
 * Applying a hold opens no view of anything. The refusal for whoever already asked
 * to read that person's file is its own message and not a generic "no": being told
 * "you cannot" when the real answer is "not you, because you asked to look" sends
 * an officer hunting for a missing duty they already have.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { useCallback, useEffect, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type ErasureRequestPage,
} from '@/lib/backoffice-api'
import {
  EMPTY_HOLD,
  HOLD_REASONS,
  emptyMessage,
  erasureMessage,
  holdIssue,
  holdIssueMessage,
  holdReasonLabel,
  holdableCategories,
  panelSummary,
  requestRows,
  urgencyTone,
  type ErasureRequest,
  type ErasureRequestState,
  type HoldDraft,
  type HoldIssue,
  type LegalHoldReason,
} from '@/lib/erasure-requests'

type LoadState = 'loading' | 'ready' | 'failed'

const HALVES: readonly { status: ErasureRequestState; label: string }[] = [
  { status: 'open', label: 'Pendientes' },
  { status: 'closed', label: 'Resueltas' },
]

export function ErasureRequests() {
  const [status, setStatus] = useState<ErasureRequestState>('open')
  const [state, setState] = useState<LoadState>('loading')
  const [page, setPage] = useState<ErasureRequestPage | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [holding, setHolding] = useState<ErasureRequest | null>(null)
  const [draft, setDraft] = useState<HoldDraft>(EMPTY_HOLD)
  const [issue, setIssue] = useState<HoldIssue | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (half: ErasureRequestState) => {
    setState('loading')
    try {
      setPage(await backofficeApi.erasureRequests({ status: half }))
      setState('ready')
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(failureMessage(caught))
      setState('failed')
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [load, status])

  const rows = page ? requestRows(page) : []
  const byId = new Map((page?.items ?? []).map((request) => [request.id, request]))

  async function suspend() {
    const broken = holdIssue(draft)
    if (broken) {
      setIssue(broken)
      return
    }
    setIssue(null)
    setBusy(true)
    try {
      await backofficeApi.applyLegalHold(
        {
          scope_description: draft.scopeDescription.trim(),
          reason_code: draft.reasonCode,
          case_reference: draft.caseReference.trim(),
          valid_to: new Date(`${draft.validTo}T23:59:59`).toISOString(),
          disposition_item_ids: draft.itemIds,
        },
        newBackofficeCommand(),
      )
      setHolding(null)
      setDraft(EMPTY_HOLD)
      setFailure(null)
      await load(status)
    } catch (caught) {
      setFailure(failureMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function release(holdId: string) {
    setBusy(true)
    try {
      await backofficeApi.releaseLegalHold(holdId, newBackofficeCommand())
      setReleasing(null)
      setFailure(null)
      await load(status)
    } catch (caught) {
      setFailure(failureMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function toggle(itemIds: readonly string[], checked: boolean) {
    setDraft((current) => ({
      ...current,
      itemIds: checked
        ? [...new Set([...current.itemIds, ...itemIds])]
        : current.itemIds.filter((id) => !itemIds.includes(id)),
    }))
  }

  return (
    <div data-erasure-requests>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Solicitudes de eliminación de datos
          </CardTitle>
          <CardDescription>
            Qué pidió borrar cada persona, qué falta para cerrarlo y cómo se resolvió, categoría por
            categoría. El plazo objetivo es de 30 días desde que llegó la solicitud. La persona
            aparece por identificador: esta pantalla sigue la solicitud, no abre sus datos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div data-erasure-halves>
            {HALVES.map((half) => (
              <Button
                key={half.status}
                type="button"
                variant={half.status === status ? 'default' : 'outline'}
                aria-pressed={half.status === status}
                onClick={() => setStatus(half.status)}
              >
                {half.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {state === 'loading' ? (
        <Alert live="polite" variant="info">
          <AlertTitle>Leyendo el seguimiento</AlertTitle>
          <AlertDescription>
            <Spinner /> Cada lectura queda registrada antes de mostrarse.
          </AlertDescription>
        </Alert>
      ) : null}

      {failure ? (
        <Alert live="assertive" variant="danger" data-erasure-failure>
          <AlertTitle>
            {state === 'failed' ? 'No se pudo leer el seguimiento' : 'No se pudo completar'}
          </AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      {state === 'ready' && page ? (
        <>
          {/* The whole answer, late requests counted, before any row. */}
          <Alert live="polite" variant={hasLate(rows) ? 'warning' : 'info'} data-erasure-summary>
            <AlertTitle>
              {hasLate(rows) ? 'Hay solicitudes fuera de plazo' : 'Estado del seguimiento'}
            </AlertTitle>
            <AlertDescription>{panelSummary(page, status)}</AlertDescription>
          </Alert>

          {rows.length === 0 ? (
            <Alert live="polite" variant="info" data-erasure-empty>
              <AlertTitle>Nada que seguir aquí</AlertTitle>
              <AlertDescription>{emptyMessage(status)}</AlertDescription>
            </Alert>
          ) : (
            <Table scrollAreaLabel="Solicitudes de eliminación" data-erasure-table>
              <TableCaption>Solicitudes de eliminación</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Solicitada</TableHead>
                  <TableHead>Fecha objetivo</TableHead>
                  <TableHead>Plazo</TableHead>
                  <TableHead>Falta</TableHead>
                  <TableHead>Resolución</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-erasure-row data-urgency={row.urgency}>
                    <TableCell data-erasure-subject>
                      <code>{row.subject}</code>
                    </TableCell>
                    <TableCell>{row.opened}</TableCell>
                    <TableCell>{row.due}</TableCell>
                    <TableCell>
                      <Badge variant={urgencyTone(row.urgency)}>{row.urgencyLabel}</Badge>
                    </TableCell>
                    <TableCell data-erasure-missing>{row.missing}</TableCell>
                    <TableCell data-erasure-resolution>
                      <ul>
                        {row.resolution.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <div data-erasure-actions>
                        {holdableCategories(byId.get(row.id) ?? emptyRequest).length > 0 ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setHolding(byId.get(row.id) ?? null)
                              setDraft(EMPTY_HOLD)
                              setIssue(null)
                            }}
                          >
                            Suspender
                          </Button>
                        ) : null}
                        {heldBy(byId.get(row.id) ?? emptyRequest).map((held) => (
                          <Button
                            key={held}
                            type="button"
                            variant="outline"
                            disabled={busy}
                            data-erasure-release
                            onClick={() => setReleasing(held)}
                          >
                            Liberar
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}

      {releasing ? (
        <Alert live="polite" variant="warning" data-erasure-release-confirm>
          <AlertTitle>Al liberar, la eliminación sigue su curso</AlertTitle>
          <AlertDescription>
            La disposición vuelve a quedar pendiente y se ejecutará como estaba previsto. Liberar no
            borra nada por sí solo, y la suspensión queda registrada.
            <div data-erasure-confirm-actions>
              <Button type="button" disabled={busy} onClick={() => void release(releasing)}>
                Confirmar liberación
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setReleasing(null)}
              >
                Cancelar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {holding ? (
        <Card data-erasure-hold-form>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Suspender por una obligación legal
            </CardTitle>
            <CardDescription>
              Detiene la eliminación de las categorías que marques, y de ninguna otra. No da acceso
              a nada: para leer lo que la persona registró hace falta una ventana excepcional. No
              existen suspensiones indefinidas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="hold-scope">Alcance</FieldLabel>
                <Input
                  id="hold-scope"
                  value={draft.scopeDescription}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, scopeDescription: event.target.value }))
                  }
                />
                {issue === 'scope' ? <FieldError>{holdIssueMessage(issue)}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="hold-reason">Motivo</FieldLabel>
                <Select
                  value={draft.reasonCode}
                  onValueChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      reasonCode: (next ?? 'judicial_order') as LegalHoldReason,
                    }))
                  }
                >
                  <SelectTrigger id="hold-reason" disabled={busy}>
                    <SelectValue>{holdReasonLabel(draft.reasonCode)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {HOLD_REASONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {holdReasonLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="hold-case">Referencia del requerimiento</FieldLabel>
                <Input
                  id="hold-case"
                  value={draft.caseReference}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, caseReference: event.target.value }))
                  }
                />
                {issue === 'case' ? <FieldError>{holdIssueMessage(issue)}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="hold-until">Vigente hasta</FieldLabel>
                <Input
                  id="hold-until"
                  type="date"
                  value={draft.validTo}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, validTo: event.target.value }))
                  }
                />
                {issue === 'vigency' ? <FieldError>{holdIssueMessage(issue)}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="hold-categories">Categorías por suspender</FieldLabel>
                <div id="hold-categories" data-erasure-hold-categories>
                  {holdableCategories(holding).map((category) => (
                    <label key={category.data_classification_code + category.action}>
                      <Checkbox
                        disabled={busy}
                        checked={category.item_ids.every((id) => draft.itemIds.includes(id))}
                        onCheckedChange={(checked) => toggle(category.item_ids, checked === true)}
                      />
                      {categoryChoice(category.data_classification_code, category.items)}
                    </label>
                  ))}
                </div>
                {issue === 'categories' ? <FieldError>{holdIssueMessage(issue)}</FieldError> : null}
              </Field>
            </FieldGroup>

            <div data-erasure-hold-actions>
              <Button type="button" disabled={busy} onClick={() => void suspend()}>
                Suspender
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setHolding(null)
                  setIssue(null)
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

const emptyRequest = { categories: [] } as unknown as ErasureRequest

/** The holds stopping anything in this request, each offered once. */
function heldBy(request: ErasureRequest): string[] {
  const holds = new Set<string>()
  for (const category of request.categories) {
    if (category.hold) holds.add(category.hold.id)
  }
  return [...holds]
}

function categoryChoice(code: string, items: number): string {
  const labels: Record<string, string> = {
    operational: 'Operación',
    audit: 'Auditoría',
    identity_pii: 'Identidad',
    training: 'Entrenamiento',
    body: 'Cuerpo',
    nutrition: 'Nutrición',
    health: 'Salud',
  }
  return `${labels[code] ?? code} (${items})`
}

function hasLate(rows: readonly { urgency: string }[]): boolean {
  return rows.some((row) => row.urgency === 'overdue')
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return erasureMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return erasureMessage(error.code)
  return erasureMessage('upstream-unavailable')
}
