'use client'

/**
 * `HU-BO-024` — publishing what a permission actually covers.
 *
 * The screen is built around criterion 3, which has no widget of its own:
 * *publishing a wider version does not widen what was already granted*. An
 * operator who believes they are editing a permission will eventually widen one
 * by accident, so nothing here is called editing. The form says "publicar la
 * versión siguiente", the history shows every version rather than only the
 * newest, and an older version is presented as what somebody is still living
 * under rather than as something obsolete.
 *
 * Exclusions are shown in their own list rather than left out. Criterion 1 asks
 * what a permission excludes, and an absence cannot answer that.
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
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type ScopeDefinition,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  ACCESS_LEVELS,
  DATA_CLASSIFICATIONS,
  SCOPE_CODES,
  actionLabel,
  classificationLabel,
  effectiveVersion,
  emptyRule,
  excludedRules,
  groupByScope,
  includedRules,
  includesSomething,
  ruleIssue,
  ruleIssueMessage,
  scopeDefinitionMessage,
  scopeLabel,
  toResourceRules,
  type AccessLevel,
  type RuleDraft,
  type ScopeCode,
} from '@/lib/scope-definitions'

type LoadState = 'loading' | 'ready' | 'failed'

export function ScopeDefinitionPublication() {
  const [state, setState] = useState<LoadState>('loading')
  const [definitions, setDefinitions] = useState<ScopeDefinition[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<ScopeCode>('body_progress')
  const [rules, setRules] = useState<RuleDraft[]>([emptyRule()])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const read = await backofficeApi.scopeDefinitions(signal)
      setDefinitions(read.items)
      setState('ready')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        window.location.assign('/')
        return
      }
      setFailure(failureMessage(caught))
      setState('failed')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function updateRule(index: number, patch: Partial<RuleDraft>) {
    setRules((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const broken = rules.map(ruleIssue).find((issue) => issue !== undefined)
    if (broken) {
      setError(ruleIssueMessage(broken))
      return
    }
    if (!includesSomething(rules)) {
      setError('Una versión que sólo excluye no concede nada. Incluye al menos un campo.')
      return
    }

    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const published = await backofficeApi.publishScopeDefinition(
        { scope_code: scope, rules: toResourceRules(rules) },
        newBackofficeCommand(),
      )
      setNotice({
        tone: 'success',
        message: `Publicada la versión ${published.version_number} de ${scopeLabel(scope)}. Quien aceptó una versión anterior la conserva.`,
      })
      setRules([emptyRule()])
      await load()
    } catch (caught) {
      setNotice({ tone: 'danger', message: failureMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <Spinner />

  if (state === 'failed') {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudieron leer las definiciones</AlertTitle>
        <AlertDescription>
          {failure ?? scopeDefinitionMessage('upstream-unavailable')}
        </AlertDescription>
      </Alert>
    )
  }

  const histories = groupByScope(definitions)

  return (
    <div data-scope-definitions>
      {notice ? (
        <Alert live="polite" variant={notice.tone === 'success' ? 'success' : 'danger'}>
          <AlertTitle>{notice.tone === 'success' ? 'Hecho' : 'No se publicó'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Publicar la versión siguiente de un permiso
          </CardTitle>
          <CardDescription>
            Una versión publicada no se edita. Publicar una más amplia no amplía lo que alguien ya
            concedió: quien aceptó la anterior sigue bajo la anterior. El número de versión lo
            asigna el servidor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-scope-form noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="scope-code">Permiso</FieldLabel>
                <Select
                  value={scope}
                  onValueChange={(next) => setScope((next ?? 'body_progress') as ScopeCode)}
                >
                  <SelectTrigger id="scope-code" disabled={busy}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {scopeLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {rules.map((draft, index) => (
                <Field key={index}>
                  <FieldLabel htmlFor={`rule-resource-${index}`}>
                    Recurso y campo {index + 1}
                  </FieldLabel>
                  <Input
                    id={`rule-resource-${index}`}
                    value={draft.resource}
                    onChange={(event) => updateRule(index, { resource: event.target.value })}
                    placeholder="execution.body_measurements"
                    autoComplete="off"
                    disabled={busy}
                  />
                  <Input
                    aria-label={`Campo de la regla ${index + 1}`}
                    value={draft.field}
                    onChange={(event) => updateRule(index, { field: event.target.value })}
                    placeholder="weight_kg o *"
                    autoComplete="off"
                    disabled={busy}
                  />
                  <Select
                    value={draft.classification}
                    onValueChange={(next) =>
                      updateRule(index, { classification: next ?? 'operational' })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Sensibilidad de la regla ${index + 1}`}
                      disabled={busy}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_CLASSIFICATIONS.map((code) => (
                        <SelectItem key={code} value={code}>
                          {classificationLabel(code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={draft.action}
                    onValueChange={(next) =>
                      updateRule(index, { action: (next ?? 'read') as AccessLevel })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Acción máxima de la regla ${index + 1}`}
                      disabled={busy}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCESS_LEVELS.map((action) => (
                        <SelectItem key={action} value={action}>
                          {actionLabel(action)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Checkbox
                    checked={draft.excluded}
                    onCheckedChange={(checked) =>
                      updateRule(index, { excluded: checked === true, historical: false })
                    }
                    disabled={busy}
                    aria-label={`Excluir la regla ${index + 1}`}
                  >
                    Excluido de este permiso
                  </Checkbox>
                  <Checkbox
                    checked={draft.historical}
                    onCheckedChange={(checked) =>
                      updateRule(index, { historical: checked === true })
                    }
                    disabled={busy || draft.excluded || draft.action !== 'read'}
                    aria-label={`Leer hacia atrás en la regla ${index + 1}`}
                  >
                    Se puede leer de antes del permiso
                  </Checkbox>
                </Field>
              ))}

              {error ? <FieldError>{error}</FieldError> : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setRules((current) => [...current, emptyRule()])}
              >
                Añadir otro recurso
              </Button>
              <Button type="submit" disabled={busy}>
                Publicar versión
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {histories.length === 0 ? (
        <Alert live="off" variant="info">
          <AlertTitle>Todavía no hay ningún permiso publicado</AlertTitle>
          <AlertDescription>
            Cuando publiques la primera versión aparecerá aquí, y cada versión posterior quedará
            junto a ella: el historial es lo que dice bajo qué versión está cada persona.
          </AlertDescription>
        </Alert>
      ) : (
        histories.map((history) => (
          <Card key={history.code}>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                {history.label}
              </CardTitle>
              <CardDescription>
                {history.versions.length === 1
                  ? 'Una sola versión publicada.'
                  : `${history.versions.length} versiones publicadas. La más nueva aplica a lo que se conceda desde ahora; las anteriores siguen vigentes para quien las aceptó.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.versions.map((version) => (
                <div key={version.id} data-scope-version>
                  <FieldGroup>
                    <Field orientation="responsive">
                      <FieldLabel htmlFor={`version-${version.id}`}>Versión</FieldLabel>
                      <Badge
                        id={`version-${version.id}`}
                        variant={
                          version.id === effectiveVersion(history)?.id ? 'success' : 'secondary'
                        }
                      >
                        v{version.version_number}
                        {version.id === effectiveVersion(history)?.id ? ' · la más nueva' : ''}
                      </Badge>
                    </Field>
                    <Field orientation="responsive">
                      <FieldLabel htmlFor={`published-${version.id}`}>Publicada</FieldLabel>
                      <span id={`published-${version.id}`}>
                        {version.published_at ? formatInstant(version.published_at) : '—'}
                      </span>
                    </Field>
                  </FieldGroup>

                  <Table scrollAreaLabel={`Contenido de la versión ${version.version_number}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recurso</TableHead>
                        <TableHead>Campo</TableHead>
                        <TableHead>Sensibilidad</TableHead>
                        <TableHead>Acción</TableHead>
                        <TableHead>Hacia atrás</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {includedRules(version).map((rule) => (
                        <TableRow key={`${rule.resource}-${rule.field}`}>
                          <TableCell>
                            <code>{rule.resource}</code>
                          </TableCell>
                          <TableCell>
                            <code>{rule.field}</code>
                          </TableCell>
                          <TableCell>
                            {classificationLabel(rule.data_classification_code)}
                          </TableCell>
                          <TableCell>{actionLabel(rule.max_action)}</TableCell>
                          <TableCell>{rule.historical_readable ? 'Sí' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {excludedRules(version).length > 0 ? (
                    <Table scrollAreaLabel={`Exclusiones de la versión ${version.version_number}`}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Queda fuera</TableHead>
                          <TableHead>Campo</TableHead>
                          <TableHead>Sensibilidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {excludedRules(version).map((rule) => (
                          <TableRow key={`excluded-${rule.resource}-${rule.field}`}>
                            <TableCell>
                              <code>{rule.resource}</code>
                            </TableCell>
                            <TableCell>
                              <code>{rule.field}</code>
                            </TableCell>
                            <TableCell>
                              {classificationLabel(rule.data_classification_code)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return scopeDefinitionMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return scopeDefinitionMessage(error.code)
  return scopeDefinitionMessage('upstream-unavailable')
}
