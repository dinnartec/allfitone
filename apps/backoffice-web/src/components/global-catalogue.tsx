'use client'

/**
 * `HU-BO-022` — publishing and archiving the global catalogue.
 *
 * Three decisions shape it.
 *
 * **Only Allfit's content is here.** A gym's private movements and activity types never
 * appear, and no form offers a scope or an owner: the commands do not take one, so the
 * screen cannot invent one.
 *
 * **Archiving is shown as what it is.** Each row says how much already depends on it and
 * the confirmation repeats that archiving withdraws it from search without breaking a
 * template that already uses it.
 *
 * **A code is never reused.** The form explains the shape a code must have and the server
 * refuses a code that already names something else; the screen does not pretend it can
 * rename one.
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
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeCommand,
  type BackofficeGlobalCatalogue,
  type GlobalCatalogueEntry,
} from '@/lib/backoffice-api'
import {
  catalogueCodeIssue,
  catalogueCommandMessage,
  catalogueKindLabel,
  catalogueNameIssue,
  catalogueOutcomeMessage,
  catalogueStatusLabel,
  catalogueStatusTone,
  equipmentExplanation,
  globalCatalogueMessage,
  inUseExplanation,
  isValidCatalogueCode,
  isValidCatalogueName,
  publishedDisciplines,
} from '@/lib/global-catalogue'

type LoadState = 'loading' | 'ready' | 'failed'

export function GlobalCatalogue() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [catalogue, setCatalogue] = useState<BackofficeGlobalCatalogue | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [commandFailure, setCommandFailure] = useState<string | null>(null)
  const pending = useRef(new Map<string, BackofficeCommand>())

  const [disciplineCode, setDisciplineCode] = useState('')
  const [disciplineName, setDisciplineName] = useState('')
  const [activityDiscipline, setActivityDiscipline] = useState('')
  const [activityCode, setActivityCode] = useState('')
  const [activityName, setActivityName] = useState('')
  const [movementDiscipline, setMovementDiscipline] = useState('')
  const [movementName, setMovementName] = useState('')
  const [formIssue, setFormIssue] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setCatalogue(await backofficeApi.globalCatalogue(controller.signal))
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
  }, [reload])

  async function run(
    key: string,
    action: 'publish' | 'archive',
    send: (command: BackofficeCommand) => Promise<GlobalCatalogueEntry>,
    onDone?: () => void,
  ) {
    const command = pending.current.get(key) ?? newBackofficeCommand()
    pending.current.set(key, command)
    setBusy(key)
    setConfirming(null)
    setOutcome(null)
    setCommandFailure(null)
    try {
      const entry = await send(command)
      pending.current.delete(key)
      setOutcome(catalogueOutcomeMessage(action, entry))
      onDone?.()
      setReload((value) => value + 1)
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      if (error instanceof BackofficeNetworkError) {
        // The command may have landed; keep it so the retry replays instead of publishing.
        setCommandFailure(catalogueCommandMessage('network-unavailable'))
        return
      }
      const code = error instanceof BackofficeApiError ? error.code : 'unknown'
      if (code !== 'idempotency-in-progress') pending.current.delete(key)
      setCommandFailure(catalogueCommandMessage(code))
      if (code === 'conflict' || code === 'not-found') setReload((value) => value + 1)
    } finally {
      setBusy(null)
    }
  }

  function publishDiscipline(event: FormEvent) {
    event.preventDefault()
    if (!validate({ discipline_code: disciplineCode, discipline_name: disciplineName })) return
    void run(
      `discipline:${disciplineCode}`,
      'publish',
      (command) =>
        backofficeApi.publishCatalogueDiscipline(
          { code: disciplineCode.trim(), name: disciplineName.trim() },
          command,
        ),
      () => {
        setDisciplineCode('')
        setDisciplineName('')
      },
    )
  }

  function publishActivityType(event: FormEvent) {
    event.preventDefault()
    if (
      !validate({
        activity_discipline: activityDiscipline,
        activity_code: activityCode,
        activity_name: activityName,
      })
    ) {
      return
    }
    void run(
      `activity:${activityCode}`,
      'publish',
      (command) =>
        backofficeApi.publishCatalogueActivityType(
          {
            discipline_code: activityDiscipline,
            code: activityCode.trim(),
            name: activityName.trim(),
          },
          command,
        ),
      () => {
        setActivityCode('')
        setActivityName('')
      },
    )
  }

  function publishMovement(event: FormEvent) {
    event.preventDefault()
    if (!validate({ movement_discipline: movementDiscipline, movement_name: movementName })) return
    void run(
      `movement:${movementName.trim().toLowerCase()}`,
      'publish',
      (command) =>
        backofficeApi.publishCatalogueMovement(
          { discipline_code: movementDiscipline, name: movementName.trim() },
          command,
        ),
      () => setMovementName(''),
    )
  }

  /** Checked here only to answer sooner; the server refuses the same shapes. */
  function validate(fields: Record<string, string>): boolean {
    const issues: Record<string, string> = {}
    for (const [field, value] of Object.entries(fields)) {
      if (field.endsWith('_code') || field.endsWith('_discipline')) {
        if (!isValidCatalogueCode(value)) issues[field] = catalogueCodeIssue()
      } else if (!isValidCatalogueName(value)) {
        issues[field] = catalogueNameIssue()
      }
    }
    setFormIssue(issues)
    return Object.keys(issues).length === 0
  }

  const archive = (entry: GlobalCatalogueEntry) =>
    run(`archive:${entry.id}`, 'archive', (command) =>
      backofficeApi.archiveCatalogueEntry(
        { kind: entry.kind, id: entry.id, code: entry.code },
        command,
      ),
    )

  const disciplineOptions = catalogue ? publishedDisciplines(catalogue) : []

  return (
    <div data-global-catalogue>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Catálogo global
          </CardTitle>
          <CardDescription>
            Lo que se publica aquí lo ven todos los gimnasios y todas las personas. Un gimnasio crea
            sus propios movimientos privados y nunca los sube aquí. Un código publicado es estable:
            no se reutiliza para otra cosa, y archivar retira de las búsquedas sin romper las
            sesiones ni las plantillas que ya lo usaban.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state === 'loading' ? <Spinner /> : null}

          {state === 'failed' ? (
            <Alert live="polite" variant="warning">
              <AlertTitle>No se pudo leer el catálogo</AlertTitle>
              <AlertDescription>
                {failure ?? globalCatalogueMessage('upstream-unavailable')}
              </AlertDescription>
            </Alert>
          ) : null}

          {outcome ? (
            <Alert live="polite" variant="success" data-catalogue-outcome>
              <AlertTitle>Listo</AlertTitle>
              <AlertDescription>{outcome}</AlertDescription>
            </Alert>
          ) : null}

          {commandFailure ? (
            <Alert live="assertive" variant="danger" data-catalogue-failure>
              <AlertTitle>No se completó</AlertTitle>
              <AlertDescription>{commandFailure}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {state === 'ready' && catalogue ? (
        <>
          <CatalogueSection
            kind="discipline"
            title="Disciplinas"
            description="La familia de actividad a la que pertenece todo lo demás."
            entries={catalogue.disciplines}
            busy={busy}
            confirming={confirming}
            onConfirm={setConfirming}
            onArchive={archive}
            form={
              <form onSubmit={publishDiscipline} data-catalogue-form="discipline">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="discipline-code">Código</FieldLabel>
                    <Input
                      id="discipline-code"
                      value={disciplineCode}
                      onChange={(event) => setDisciplineCode(event.target.value)}
                      placeholder="yoga"
                      disabled={busy !== null}
                    />
                    {formIssue.discipline_code ? (
                      <FieldError>{formIssue.discipline_code}</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="discipline-name">Nombre</FieldLabel>
                    <Input
                      id="discipline-name"
                      value={disciplineName}
                      onChange={(event) => setDisciplineName(event.target.value)}
                      placeholder="Yoga"
                      disabled={busy !== null}
                    />
                    {formIssue.discipline_name ? (
                      <FieldError>{formIssue.discipline_name}</FieldError>
                    ) : null}
                  </Field>
                </FieldGroup>
                <Button type="submit" disabled={busy !== null}>
                  Publicar disciplina
                </Button>
              </form>
            }
          />

          <CatalogueSection
            kind="activity_type"
            title="Tipos de actividad"
            description="La clase concreta de actividad; decide qué reglas de resultado aplican."
            entries={catalogue.activity_types}
            busy={busy}
            confirming={confirming}
            onConfirm={setConfirming}
            onArchive={archive}
            form={
              <form onSubmit={publishActivityType} data-catalogue-form="activity_type">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="activity-discipline">Disciplina</FieldLabel>
                    {/* With the labels the trigger reads the name, not the raw code. */}
                    <Select
                      items={disciplineOptions.map((entry) => ({
                        value: entry.code ?? '',
                        label: entry.name,
                      }))}
                      value={activityDiscipline}
                      onValueChange={(value) => setActivityDiscipline(String(value ?? ''))}
                    >
                      <SelectTrigger
                        id="activity-discipline"
                        disabled={busy !== null || disciplineOptions.length === 0}
                      >
                        <SelectValue placeholder="Elige una disciplina publicada" />
                      </SelectTrigger>
                      <SelectContent>
                        {disciplineOptions.map((entry) => (
                          <SelectItem key={entry.id} value={entry.code ?? ''}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formIssue.activity_discipline ? (
                      <FieldError>Elige una disciplina publicada.</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-code">Código</FieldLabel>
                    <Input
                      id="activity-code"
                      value={activityCode}
                      onChange={(event) => setActivityCode(event.target.value)}
                      placeholder="vinyasa"
                      disabled={busy !== null}
                    />
                    {formIssue.activity_code ? (
                      <FieldError>{formIssue.activity_code}</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="activity-name">Nombre</FieldLabel>
                    <Input
                      id="activity-name"
                      value={activityName}
                      onChange={(event) => setActivityName(event.target.value)}
                      placeholder="Vinyasa"
                      disabled={busy !== null}
                    />
                    {formIssue.activity_name ? (
                      <FieldError>{formIssue.activity_name}</FieldError>
                    ) : null}
                  </Field>
                </FieldGroup>
                <Button type="submit" disabled={busy !== null}>
                  Publicar tipo de actividad
                </Button>
              </form>
            }
          />

          <CatalogueSection
            kind="movement"
            title="Movimientos"
            description="La acción o técnica reutilizable. Se identifica por su nombre, así que el mismo nombre escrito distinto es el mismo movimiento."
            entries={catalogue.movements}
            busy={busy}
            confirming={confirming}
            onConfirm={setConfirming}
            onArchive={archive}
            form={
              <form onSubmit={publishMovement} data-catalogue-form="movement">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="movement-discipline">Disciplina</FieldLabel>
                    <Select
                      items={disciplineOptions.map((entry) => ({
                        value: entry.code ?? '',
                        label: entry.name,
                      }))}
                      value={movementDiscipline}
                      onValueChange={(value) => setMovementDiscipline(String(value ?? ''))}
                    >
                      <SelectTrigger
                        id="movement-discipline"
                        disabled={busy !== null || disciplineOptions.length === 0}
                      >
                        <SelectValue placeholder="Elige una disciplina publicada" />
                      </SelectTrigger>
                      <SelectContent>
                        {disciplineOptions.map((entry) => (
                          <SelectItem key={entry.id} value={entry.code ?? ''}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formIssue.movement_discipline ? (
                      <FieldError>Elige una disciplina publicada.</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="movement-name">Nombre</FieldLabel>
                    <Input
                      id="movement-name"
                      value={movementName}
                      onChange={(event) => setMovementName(event.target.value)}
                      placeholder="Guerrero II"
                      disabled={busy !== null}
                    />
                    {formIssue.movement_name ? (
                      <FieldError>{formIssue.movement_name}</FieldError>
                    ) : null}
                  </Field>
                </FieldGroup>
                <Button type="submit" disabled={busy !== null}>
                  Publicar movimiento
                </Button>
              </form>
            }
          />

          <Card data-catalogue-equipment>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Equipamiento
              </CardTitle>
              <CardDescription>
                {equipmentExplanation(catalogue.equipment_availability)}
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function CatalogueSection({
  kind,
  title,
  description,
  entries,
  busy,
  confirming,
  onConfirm,
  onArchive,
  form,
}: {
  kind: GlobalCatalogueEntry['kind']
  title: string
  description: string
  entries: GlobalCatalogueEntry[]
  busy: string | null
  confirming: string | null
  onConfirm: (id: string | null) => void
  onArchive: (entry: GlobalCatalogueEntry) => void
  form: ReactNode
}) {
  const pendingArchival = entries.find((entry) => entry.id === confirming)

  return (
    <Card data-catalogue-section={kind}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {form}

        {/* The confirmation lives above the table, not inside a cell: a row that grows
            sideways pushes its own buttons out of the scroll area. */}
        {pendingArchival ? (
          <Alert live="polite" variant="warning" data-catalogue-confirm>
            <AlertTitle>
              ¿Archivar {catalogueKindLabel(pendingArchival.kind).toLowerCase()} «
              {pendingArchival.name}»?
            </AlertTitle>
            <AlertDescription>
              Sale de las búsquedas; lo que ya la usaba sigue funcionando.{' '}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() => onArchive(pendingArchival)}
              >
                Sí, archivar
              </Button>{' '}
              <Button type="button" size="sm" variant="ghost" onClick={() => onConfirm(null)}>
                No
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {entries.length === 0 ? (
          <span data-catalogue-empty>Todavía no hay nada publicado aquí.</span>
        ) : (
          <Table scrollAreaLabel={title}>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>{kind === 'movement' ? 'Disciplina' : 'Código'}</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>En uso</TableHead>
                <TableHead>Archivar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-catalogue-entry data-status={entry.status}>
                  <TableCell>{entry.name}</TableCell>
                  <TableCell>
                    <code>{kind === 'movement' ? entry.discipline_code : entry.code}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={catalogueStatusTone(entry.status)}>
                      {catalogueStatusLabel(entry.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{inUseExplanation(entry)}</TableCell>
                  <TableCell>
                    {entry.status !== 'published' ? (
                      <span data-catalogue-reason>Ya está fuera de las búsquedas.</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        aria-label={`Archivar ${entry.name}`}
                        onClick={() => onConfirm(entry.id)}
                      >
                        {busy === `archive:${entry.id}` ? 'Archivando…' : 'Archivar'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function readFailure(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return globalCatalogueMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return globalCatalogueMessage(error.code)
  return globalCatalogueMessage('upstream-unavailable')
}
