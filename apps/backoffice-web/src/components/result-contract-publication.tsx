'use client'

/**
 * `HU-BO-023` — publishing what an activity requires for a session to count as
 * complete.
 *
 * The screen shows the published version rather than a browsable catalogue,
 * because `OP-CAT-006` is a command and the two queries that would list existing
 * contracts — `OP-CAT-008` and `OP-CAT-012` — belong to the `/catalog/v1`
 * surface, which is not mounted yet. Inventing a read here would put a second,
 * uncontracted endpoint in the product.
 *
 * What the response does carry is the evidence the story asks for: the version
 * number the server assigned, and the association it superseded with the window
 * that closed it. Publishing a correction is visibly a new version, never an
 * edit of the previous one.
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { Textarea } from '@allfitone/react/components/textarea'
import { useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type ResultContract,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  ACTIVITY_FAMILIES,
  activityFamilyLabel,
  contractStatusLabel,
  emptyFixtures,
  fixtureIssue,
  fixtureIssueMessage,
  fixturesDemonstrateBothOutcomes,
  isValidActivityTypeId,
  isValidContractCode,
  parseJsonDocument,
  resultContractMessage,
  toContractFixtures,
  type ActivityFamily,
  type FixtureDraft,
} from '@/lib/result-contracts'

export function ResultContractPublication() {
  const [contractCode, setContractCode] = useState('')
  const [activityFamily, setActivityFamily] = useState<ActivityFamily>('strength')
  const [activityTypeId, setActivityTypeId] = useState('')
  const [envelope, setEnvelope] = useState('{\n  "schema": 1\n}')
  const [minimums, setMinimums] = useState('{\n  "target_sets": true\n}')
  const [fixtures, setFixtures] = useState<FixtureDraft[]>(emptyFixtures)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<ResultContract | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)

  function updateFixture(index: number, patch: Partial<FixtureDraft>) {
    setFixtures((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!isValidContractCode(contractCode)) {
      setError('El código va en minúsculas, con puntos o guiones bajos, y al menos dos caracteres.')
      return
    }
    if (!isValidActivityTypeId(activityTypeId)) {
      setError('Escribe el identificador del tipo de actividad.')
      return
    }
    const parsedEnvelope = parseJsonDocument(envelope)
    if (!parsedEnvelope.ok) {
      setError('El envelope debe ser un objeto JSON.')
      return
    }
    const parsedMinimums = parseJsonDocument(minimums)
    if (!parsedMinimums.ok) {
      setError('Los mínimos deben ser un objeto JSON.')
      return
    }
    const broken = fixtures.map(fixtureIssue).find((issue) => issue !== undefined)
    if (broken) {
      setError(fixtureIssueMessage(broken))
      return
    }
    if (!fixturesDemonstrateBothOutcomes(fixtures)) {
      setError('Hace falta un caso que el contrato acepte y uno que rechace.')
      return
    }

    setError(null)
    setBusy(true)
    setNotice(null)
    try {
      const resource = await backofficeApi.publishResultContract(
        {
          contract_code: contractCode,
          activity_family: activityFamily,
          envelope: parsedEnvelope.value,
          minimums: parsedMinimums.value,
          fixtures: toContractFixtures(fixtures),
          activity_type_id: activityTypeId,
        },
        newBackofficeCommand(),
      )
      setPublished(resource)
      setNotice({
        tone: 'success',
        message: `Publicada la versión ${resource.version_number} de ${resource.contract_code}.`,
      })
    } catch (failure) {
      setNotice({ tone: 'danger', message: failureMessage(failure) })
    } finally {
      setBusy(false)
    }
  }

  async function deprecate() {
    if (!published) return
    setBusy(true)
    setNotice(null)
    try {
      const resource = await backofficeApi.deprecateResultContract(
        published.id,
        newBackofficeCommand(),
      )
      setPublished(resource)
      setNotice({
        tone: 'success',
        message: 'Contrato deprecado. Las ejecuciones que ya lo congelaron siguen válidas.',
      })
    } catch (failure) {
      setNotice({ tone: 'danger', message: failureMessage(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-result-contracts>
      {notice ? (
        <Alert live="polite" variant={notice.tone === 'success' ? 'success' : 'danger'}>
          <AlertTitle>{notice.tone === 'success' ? 'Hecho' : 'No se publicó'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Publicar reglas de validación
          </CardTitle>
          <CardDescription>
            Una versión publicada no se edita: corregirla exige publicar la siguiente, y publicarla
            no reinterpreta las sesiones ya registradas. El servidor asigna el número de versión.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-result-contract-form noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="contract-code">Código del contrato</FieldLabel>
                <Input
                  id="contract-code"
                  value={contractCode}
                  onChange={(event) => setContractCode(event.target.value)}
                  placeholder="strength.detailed"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="contract-family">Familia de actividad</FieldLabel>
                <Select
                  value={activityFamily}
                  onValueChange={(value) => setActivityFamily(value as ActivityFamily)}
                >
                  <SelectTrigger id="contract-family" disabled={busy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_FAMILIES.map((family) => (
                      <SelectItem key={family} value={family}>
                        {activityFamilyLabel(family)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="contract-activity-type">Tipo de actividad</FieldLabel>
                <Input
                  id="contract-activity-type"
                  value={activityTypeId}
                  onChange={(event) => setActivityTypeId(event.target.value)}
                  placeholder="019a5000-0000-7000-8000-000000000301"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contract-envelope">Envelope</FieldLabel>
                <Textarea
                  id="contract-envelope"
                  value={envelope}
                  onChange={(event) => setEnvelope(event.target.value)}
                  rows={5}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contract-minimums">Mínimos por completitud</FieldLabel>
                <Textarea
                  id="contract-minimums"
                  value={minimums}
                  onChange={(event) => setMinimums(event.target.value)}
                  rows={5}
                  disabled={busy}
                />
              </Field>
              {fixtures.map((draft, index) => (
                <Field key={draft.kind}>
                  <FieldLabel htmlFor={`contract-fixture-${draft.kind}`}>
                    {draft.kind === 'valid' ? 'Caso que el contrato acepta' : 'Caso que rechaza'}
                  </FieldLabel>
                  <Textarea
                    id={`contract-fixture-${draft.kind}`}
                    value={draft.payload}
                    onChange={(event) => updateFixture(index, { payload: event.target.value })}
                    rows={3}
                    disabled={busy}
                  />
                  <Input
                    aria-label={
                      draft.kind === 'valid'
                        ? 'Resultado esperado del caso aceptado'
                        : 'Resultado esperado del caso rechazado'
                    }
                    value={draft.expected}
                    onChange={(event) => updateFixture(index, { expected: event.target.value })}
                    placeholder={draft.kind === 'valid' ? 'accepted' : 'missing_sets'}
                    autoComplete="off"
                    disabled={busy}
                  />
                </Field>
              ))}
              {error ? <FieldError>{error}</FieldError> : null}
              <Button type="submit" disabled={busy}>
                Publicar versión
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {published ? (
        <PublishedContract contract={published} busy={busy} onDeprecate={() => void deprecate()} />
      ) : (
        <Alert live="off" variant="info">
          <AlertTitle>Todavía no publicaste una versión</AlertTitle>
          <AlertDescription>
            Aquí aparecerá la versión que el servidor asigne, con sus casos de prueba y la
            asociación que reemplace. Consultar el catálogo ya publicado necesita las operaciones de
            lectura de <code>/catalog/v1</code>, que aún no están montadas.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function PublishedContract({
  contract,
  busy,
  onDeprecate,
}: {
  contract: ResultContract
  busy: boolean
  onDeprecate: () => void
}) {
  const superseded = contract.activity_type_bindings.filter((binding) => binding.valid_to !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Versión publicada
        </CardTitle>
        <CardDescription>
          {contract.contract_code} · versión {contract.version_number} ·{' '}
          {activityFamilyLabel(contract.activity_family)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="published-status">Estado</FieldLabel>
            <Badge
              id="published-status"
              variant={contract.status === 'published' ? 'success' : 'secondary'}
            >
              {contractStatusLabel(contract.status)}
            </Badge>
          </Field>
        </FieldGroup>

        <Table scrollAreaLabel="Casos de prueba del contrato">
          <TableHeader>
            <TableRow>
              <TableHead>Caso</TableHead>
              <TableHead>Contenido</TableHead>
              <TableHead>Esperado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contract.fixtures.map((fixture) => (
              <TableRow key={fixture.id}>
                <TableCell>
                  <Badge variant={fixture.kind === 'valid' ? 'success' : 'destructive'}>
                    {fixture.kind === 'valid' ? 'Aceptado' : 'Rechazado'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <code>{JSON.stringify(fixture.payload)}</code>
                </TableCell>
                <TableCell>{fixture.expected}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {superseded.length > 0 ? (
          <Alert live="polite" variant="info">
            <AlertTitle>Esta publicación reemplazó una asociación anterior</AlertTitle>
            <AlertDescription>
              La anterior se cerró el {formatInstant(superseded[0]?.valid_to)} en lugar de borrarse.
              Las sesiones registradas bajo ella conservan el contrato que congelaron.
            </AlertDescription>
          </Alert>
        ) : null}

        {contract.status === 'published' ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={onDeprecate}>
            Deprecar esta versión
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return resultContractMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return resultContractMessage(error.code)
  return resultContractMessage('upstream-unavailable')
}
