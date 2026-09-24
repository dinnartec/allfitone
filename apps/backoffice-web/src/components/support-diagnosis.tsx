'use client'

/**
 * `HU-BO-031` — diagnosing a failed operation without opening anyone's data.
 *
 * The screen opens with the delivery circuits rather than the feed. Most "the
 * notification never arrived" cases are one tripped channel, and reading forty
 * individual failures to discover that is the wrong order of work.
 *
 * Only `dead_lettered`, `stalled` and `rejected_final` read as failures.
 * `retrying` is warned about because the platform is still working on it, and
 * `pending` is not a problem at all — flattening them would turn a healthy queue
 * into a wall of red and train the operator to ignore it.
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
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
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
  type SupportDeliveryCircuit,
  type SupportOperation,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  SUPPORT_OPERATION_SOURCES,
  SUPPORT_OPERATION_STATES,
  circuitSummary,
  circuitTone,
  operationStateLabel,
  operationStateTone,
  sourceLabel,
  supportDiagnosisMessage,
  type SupportOperationSourceKind,
  type SupportOperationState,
} from '@/lib/support-diagnosis'

type LoadState = 'loading' | 'ready' | 'failed'

const ANY = 'any'

export function SupportDiagnosis() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [circuits, setCircuits] = useState<SupportDeliveryCircuit[]>([])
  const [operations, setOperations] = useState<SupportOperation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [appending, setAppending] = useState(false)
  const [source, setSource] = useState<SupportOperationSourceKind | typeof ANY>(ANY)
  const [operationState, setOperationState] = useState<SupportOperationState | typeof ANY>(ANY)

  const filters = useCallback(
    () => ({
      ...(source === ANY ? {} : { source }),
      ...(operationState === ANY ? {} : { state: operationState }),
    }),
    [source, operationState],
  )

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const [health, feed] = await Promise.all([
          backofficeApi.supportDeliveryCircuits(controller.signal),
          backofficeApi.supportOperations(filters(), controller.signal),
        ])
        setCircuits(health.items)
        setOperations(feed.data)
        setCursor(feed.page.next_cursor)
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(failureMessage(error))
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [filters])

  async function loadMore() {
    if (!cursor) return
    setAppending(true)
    try {
      const feed = await backofficeApi.supportOperations({ ...filters(), cursor })
      setOperations((current) => [...current, ...feed.data])
      setCursor(feed.page.next_cursor)
    } catch (error) {
      setFailure(failureMessage(error))
    } finally {
      setAppending(false)
    }
  }

  if (state === 'loading') return <Spinner />

  if (state === 'failed') {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo leer el estado técnico</AlertTitle>
        <AlertDescription>
          {failure ?? supportDiagnosisMessage('upstream-unavailable')}
        </AlertDescription>
      </Alert>
    )
  }

  const summary = circuitSummary(circuits)

  return (
    <div data-support-diagnosis>
      {summary ? (
        <Alert live="polite" variant="warning">
          <AlertTitle>Un canal de entrega está caído</AlertTitle>
          <AlertDescription>{summary}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Canales de entrega
          </CardTitle>
          <CardDescription>
            Contadores por tipo de aviso. Nada de esto pertenece a una persona, y responde «¿está
            caído el canal entero?» antes de perseguir un aviso suelto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {circuits.length === 0 ? (
            <Alert live="off" variant="info">
              <AlertTitle>Ningún canal ha reportado entregas</AlertTitle>
              <AlertDescription>
                Todavía no hay ventanas de entrega registradas. No es una falla: es que aún no se ha
                enviado nada.
              </AlertDescription>
            </Alert>
          ) : (
            <Table scrollAreaLabel="Canales de entrega">
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de aviso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Aciertos</TableHead>
                  <TableHead>Fallas</TableHead>
                  <TableHead>Reabre</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {circuits.map((circuit) => (
                  <TableRow key={circuit.event_type}>
                    <TableCell>
                      <code>{circuit.event_type}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={circuitTone(circuit.state)}>{circuit.state}</Badge>
                    </TableCell>
                    <TableCell>{circuit.success_count}</TableCell>
                    <TableCell>{circuit.failure_count}</TableCell>
                    <TableCell>
                      {circuit.opened_until ? formatInstant(circuit.opened_until) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Operaciones
          </CardTitle>
          <CardDescription>
            Identificadores, estados, marcas de tiempo, errores y reintentos. Nunca el contenido de
            un aviso ni la respuesta de un comando: esta pantalla existe para diagnosticar sin abrir
            el dato de nadie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="diagnosis-source">Tipo</FieldLabel>
              <Select
                value={source}
                onValueChange={(next) =>
                  setSource((next ?? ANY) as SupportOperationSourceKind | typeof ANY)
                }
              >
                <SelectTrigger id="diagnosis-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Todo</SelectItem>
                  {SUPPORT_OPERATION_SOURCES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {sourceLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="diagnosis-state">Estado</FieldLabel>
              <Select
                value={operationState}
                onValueChange={(next) =>
                  setOperationState((next ?? ANY) as SupportOperationState | typeof ANY)
                }
              >
                <SelectTrigger id="diagnosis-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Todo</SelectItem>
                  {SUPPORT_OPERATION_STATES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {operationStateLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          {operations.length === 0 ? (
            <Alert live="polite" variant="info">
              <AlertTitle>Nada que revisar con esos filtros</AlertTitle>
              <AlertDescription>
                Con este tipo y este estado no hay ninguna operación. Cambia los filtros para
                ampliar la búsqueda.
              </AlertDescription>
            </Alert>
          ) : (
            <Table scrollAreaLabel="Operaciones">
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Qué</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Intentos</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((operation) => (
                  <TableRow key={`${operation.source}-${operation.reference_id}`}>
                    <TableCell>{sourceLabel(operation.source)}</TableCell>
                    <TableCell>
                      <code>{operation.label}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={operationStateTone(operation.state)}>
                        {operationStateLabel(operation.state)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatInstant(operation.occurred_at)}</TableCell>
                    <TableCell>{operation.attempt_count}</TableCell>
                    <TableCell>
                      {operation.last_error_code ? <code>{operation.last_error_code}</code> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {cursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={appending}
              onClick={() => void loadMore()}
            >
              {appending ? 'Cargando…' : 'Ver más operaciones'}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return supportDiagnosisMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return supportDiagnosisMessage(error.code)
  return supportDiagnosisMessage('upstream-unavailable')
}
