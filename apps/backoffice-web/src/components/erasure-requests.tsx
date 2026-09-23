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
  type ErasureRequestPage,
} from '@/lib/backoffice-api'
import {
  emptyMessage,
  erasureMessage,
  panelSummary,
  requestRows,
  urgencyTone,
  type ErasureRequestState,
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

      {state === 'failed' && failure ? (
        <Alert live="assertive" variant="danger" data-erasure-failure>
          <AlertTitle>No se pudo leer el seguimiento</AlertTitle>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}
    </div>
  )
}

function hasLate(rows: readonly { urgency: string }[]): boolean {
  return rows.some((row) => row.urgency === 'overdue')
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return erasureMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return erasureMessage(error.code)
  return erasureMessage('upstream-unavailable')
}
