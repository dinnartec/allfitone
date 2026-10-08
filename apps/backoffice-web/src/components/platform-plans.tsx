'use client'

/**
 * `HU-BO-025`, `HU-BO-026` — the plans Allfit sells.
 *
 * Every plan shows three things apart: the version in force, the proposal waiting for
 * review with what it changes, and the history. Nothing changes for anybody until a
 * proposal is published, and the person who proposed it cannot publish it — the screen
 * says so beside the button instead of letting the server refuse.
 *
 * A new proposal starts from the version in force, so the operator edits a difference
 * rather than retyping a plan. The functions a plan can limit arrive from the API and
 * are listed whole, because a version declares every one of them; while product has not
 * decided the list, the form says there is nothing to limit yet.
 *
 * Commands keep their identifiers across a lost response, so a retry replays rather
 * than proposing twice.
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { Spinner } from '@allfitone/react/components/spinner'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeCommand,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  BILLING_PERIOD_OPTIONS,
  PLAN_CURRENCIES,
  PLAN_KIND_OPTIONS,
  currencyLabel,
  changeLines,
  featureLimits,
  featureName,
  formatPrice,
  hasFreePlan,
  initialFeatureDrafts,
  isValidPlanCode,
  isValidPlanName,
  limitPhrase,
  parsePriceToMinor,
  planCommandMessage,
  planKindLabel,
  planOutcomeMessage,
  planStatusLabel,
  plansMessage,
  priceIssue,
  reviewNote,
  versionStatus,
  type FeatureDraft,
  type PlanAction,
  type PlatformPlan,
  type PlatformPlanBillingPeriod,
  type PlatformPlanCatalogue,
  type PlatformPlanKind,
  type PlatformPlanVersion,
  type PlatformPlanVersionProposal,
} from '@/lib/platform-plans'

type LoadState = 'loading' | 'ready' | 'failed'

export function PlatformPlans() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [catalogue, setCatalogue] = useState<PlatformPlanCatalogue | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [commandFailure, setCommandFailure] = useState<string | null>(null)
  const pending = useRef(new Map<string, BackofficeCommand>())

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<PlatformPlanKind | ''>('')
  const [createIssue, setCreateIssue] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setCatalogue(await backofficeApi.platformPlans(controller.signal))
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(
          error instanceof BackofficeNetworkError
            ? plansMessage('network-unavailable')
            : plansMessage(error instanceof BackofficeApiError ? error.code : 'unknown'),
        )
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [reload])

  async function run(
    key: string,
    action: PlanAction,
    send: (command: BackofficeCommand) => Promise<PlatformPlan>,
  ): Promise<boolean> {
    const command = pending.current.get(key) ?? newBackofficeCommand()
    pending.current.set(key, command)
    setBusy(key)
    setOutcome(null)
    setCommandFailure(null)
    try {
      const plan = await send(command)
      pending.current.delete(key)
      setOutcome(planOutcomeMessage(action, plan))
      setReload((value) => value + 1)
      return true
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return false
      }
      if (error instanceof BackofficeNetworkError) {
        // The command may have landed; keep it so the retry replays instead of repeating.
        setCommandFailure(planCommandMessage(action, 'network-unavailable'))
        return false
      }
      const code = error instanceof BackofficeApiError ? error.code : 'unknown'
      if (code !== 'idempotency-in-progress') pending.current.delete(key)
      setCommandFailure(planCommandMessage(action, code))
      if (code === 'conflict' || code === 'not-found') setReload((value) => value + 1)
      return false
    } finally {
      setBusy(null)
    }
  }

  function createPlan(event: FormEvent) {
    event.preventDefault()
    if (!isValidPlanCode(code)) {
      setCreateIssue(
        'El código va en minúsculas, sin espacios ni tildes: letras, números y guion bajo.',
      )
      return
    }
    if (!isValidPlanName(name)) {
      setCreateIssue('El nombre no puede quedar vacío ni pasar de 80 caracteres.')
      return
    }
    if (kind === '') {
      setCreateIssue('Elige si el plan es gratis o de pago.')
      return
    }
    setCreateIssue(null)
    const plan = { code: code.trim(), name: name.trim(), plan_kind: kind }
    void run(`create:${plan.code}`, 'create', (command) =>
      backofficeApi.createPlatformPlan(plan, command),
    ).then((done) => {
      if (!done) return
      setCode('')
      setName('')
      setKind('')
    })
  }

  const freeExists = catalogue ? hasFreePlan(catalogue) : false
  const kindOptions = PLAN_KIND_OPTIONS.filter((option) => option.value !== 'free' || !freeExists)

  return (
    <div data-platform-plans>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Planes de Allfit
          </CardTitle>
          <CardDescription>
            Lo que Allfit le vende a las personas, el plan gratuito incluido. Un cambio de precio o
            de lo que incluye un plan es una versión nueva: la propone una persona y la publica
            otra, y quien ya estaba suscrito conserva la versión que aceptó. Nada de esto cobra: las
            funciones de privacidad no se pueden limitar en ningún plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state === 'loading' ? <Spinner /> : null}

          {state === 'failed' ? (
            <Alert live="polite" variant="warning" data-plans-failure>
              <AlertTitle>No se pudieron leer los planes</AlertTitle>
              <AlertDescription>{failure ?? plansMessage('upstream-unavailable')}</AlertDescription>
            </Alert>
          ) : null}

          {outcome ? (
            <Alert live="polite" variant="success" data-plans-outcome>
              <AlertTitle>Listo</AlertTitle>
              <AlertDescription>{outcome}</AlertDescription>
            </Alert>
          ) : null}

          {commandFailure ? (
            <Alert live="assertive" variant="danger" data-plans-command-failure>
              <AlertTitle>No se completó</AlertTitle>
              <AlertDescription>{commandFailure}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {state === 'ready' && catalogue ? (
        <>
          <Card data-plans-features>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Funciones que un plan puede limitar
              </CardTitle>
              <CardDescription>
                Cada función llega con el código que hace cumplir su límite, así que la lista cambia
                con un despliegue y no desde aquí.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {catalogue.feature_catalog.length === 0 ? (
                <p data-plans-features-empty>
                  Todavía no hay funciones definidas: qué incluye cada plan no está decidido.
                  Mientras tanto, un plan se publica con su precio y su periodo, y sus límites se
                  agregan en una versión posterior cuando existan.
                </p>
              ) : (
                <ul data-plans-feature-list>
                  {catalogue.feature_catalog.map((feature) => (
                    <li key={feature.code}>
                      <span>{feature.name}</span> <code>{feature.code}</code>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {catalogue.plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              catalogue={catalogue}
              busy={busy}
              onPropose={(proposal) =>
                run(`propose:${plan.id}`, 'propose', (command) =>
                  backofficeApi.proposePlatformPlanVersion(plan.id, proposal, command),
                )
              }
              onPublish={(version) =>
                void run(`publish:${version.id}`, 'publish', (command) =>
                  backofficeApi.publishPlatformPlanVersion(plan.id, version.id, command),
                )
              }
              onWithdraw={(version) =>
                void run(`withdraw:${version.id}`, 'withdraw', (command) =>
                  backofficeApi.withdrawPlatformPlanVersion(plan.id, version.id, command),
                )
              }
            />
          ))}

          <Card data-plans-create>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Crear un plan
              </CardTitle>
              <CardDescription>
                Un plan es un código estable, un nombre y un tipo. Nace sin nada en vigor: su
                primera versión se propone después y la publica otra persona.
                {freeExists
                  ? ' Ya existe el plan gratuito: sus límites cambian publicando versiones de ese mismo plan.'
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createPlan} data-plans-create-form>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="plan-code">Código</FieldLabel>
                    <Input
                      id="plan-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="premium"
                      disabled={busy !== null}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="plan-name">Nombre</FieldLabel>
                    <Input
                      id="plan-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Premium"
                      disabled={busy !== null}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="plan-kind">Tipo</FieldLabel>
                    <Select
                      items={kindOptions}
                      value={kind}
                      onValueChange={(value) => setKind((value ?? '') as PlatformPlanKind | '')}
                    >
                      <SelectTrigger id="plan-kind" disabled={busy !== null}>
                        <SelectValue placeholder="Gratis o de pago" />
                      </SelectTrigger>
                      <SelectContent>
                        {kindOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {createIssue ? <FieldError>{createIssue}</FieldError> : null}
                </FieldGroup>
                <Button type="submit" disabled={busy !== null}>
                  Crear plan
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function PlanCard({
  plan,
  catalogue,
  busy,
  onPropose,
  onPublish,
  onWithdraw,
}: {
  plan: PlatformPlan
  catalogue: PlatformPlanCatalogue
  busy: string | null
  onPropose: (proposal: PlatformPlanVersionProposal) => Promise<boolean>
  onPublish: (version: PlatformPlanVersion) => void
  onWithdraw: (version: PlatformPlanVersion) => void
}) {
  const inForce = plan.current_version
  const proposal = plan.proposal
  const past = plan.history.filter(
    (version) => version.id !== inForce?.id && version.id !== proposal?.id,
  )

  return (
    <Card data-plan={plan.code} data-plan-status={plan.status}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {plan.name}
        </CardTitle>
        <CardDescription>
          <code>{plan.code}</code> ·{' '}
          <Badge variant="secondary">{planKindLabel(plan.plan_kind)}</Badge>{' '}
          <Badge variant={plan.status === 'published' ? 'success' : 'warning'}>
            {planStatusLabel(plan.status)}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div data-plan-body>
          <section data-plan-in-force>
            <h3>En vigor</h3>
            {inForce ? (
              <VersionSummary version={inForce} catalogue={catalogue} />
            ) : (
              <p>
                Nada todavía: este plan no ofrece nada hasta que se publique su primera versión.
              </p>
            )}
          </section>

          {proposal ? (
            <section data-plan-proposal data-proposed-by-self={proposal.proposed_by_self}>
              <h3>Propuesta en revisión</h3>
              <p data-plan-review-note>{reviewNote(proposal)}</p>
              <ul data-plan-changes aria-label="Qué cambia">
                {changeLines(catalogue, proposal, inForce).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <VersionSummary version={proposal} catalogue={catalogue} />
              <div data-plan-actions>
                <Button
                  type="button"
                  onClick={() => onPublish(proposal)}
                  disabled={busy !== null || proposal.proposed_by_self}
                >
                  Publicar versión {proposal.version_number}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onWithdraw(proposal)}
                  disabled={busy !== null}
                >
                  Retirar propuesta
                </Button>
              </div>
            </section>
          ) : (
            <ProposalForm plan={plan} catalogue={catalogue} busy={busy} onPropose={onPropose} />
          )}

          {past.length > 0 ? (
            <section data-plan-history>
              <h3>Historial</h3>
              <ul>
                {past.map((version) => {
                  const status = versionStatus(version.status)
                  return (
                    <li key={version.id} data-plan-history-version={version.version_number}>
                      <span>Versión {version.version_number}</span>{' '}
                      <Badge variant={status.tone}>{status.label}</Badge>{' '}
                      <span>{formatPrice(version)}</span>
                      {version.withdrawn_at ? (
                        <span> · retirada {formatInstant(version.withdrawn_at)}</span>
                      ) : null}
                      {version.deprecated_at ? (
                        <span> · reemplazada {formatInstant(version.deprecated_at)}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function VersionSummary({
  version,
  catalogue,
}: {
  version: PlatformPlanVersion
  catalogue: PlatformPlanCatalogue
}) {
  const status = versionStatus(version.status)
  return (
    <div data-plan-version={version.version_number}>
      <p>
        <strong data-plan-price>{formatPrice(version)}</strong> · Versión {version.version_number}{' '}
        <Badge variant={status.tone}>{status.label}</Badge>
      </p>
      <p>
        {version.published_at
          ? `Publicada: ${formatInstant(version.published_at)}`
          : `Propuesta: ${formatInstant(version.proposed_at)}`}
      </p>
      {version.features.length > 0 ? (
        <ul data-plan-limits>
          {version.features.map((feature) => (
            <li key={feature.feature_code}>
              {featureName(catalogue, feature.feature_code)}:{' '}
              {limitPhrase(
                feature,
                catalogue.feature_catalog.find((entry) => entry.code === feature.feature_code)
                  ?.unit ?? null,
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ProposalForm({
  plan,
  catalogue,
  busy,
  onPropose,
}: {
  plan: PlatformPlan
  catalogue: PlatformPlanCatalogue
  busy: string | null
  onPropose: (proposal: PlatformPlanVersionProposal) => Promise<boolean>
}) {
  const inForce = plan.current_version
  const paid = plan.plan_kind === 'paid'
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState<string>(inForce?.currency_code ?? 'COP')
  const [period, setPeriod] = useState<PlatformPlanBillingPeriod | ''>(
    inForce?.billing_period ?? '',
  )
  const [drafts, setDrafts] = useState<FeatureDraft[]>(() =>
    initialFeatureDrafts(catalogue, inForce),
  )
  const [issue, setIssue] = useState<string | null>(null)
  const idPrefix = `plan-${plan.code}`

  function update(index: number, change: Partial<FeatureDraft>) {
    setDrafts((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...change } : draft)),
    )
  }

  function propose(event: FormEvent) {
    event.preventDefault()
    let amount = 0
    if (paid) {
      const parsed = parsePriceToMinor(price, currency)
      if (parsed === undefined) {
        setIssue(priceIssue())
        return
      }
      if (period === '') {
        setIssue('Elige si el cobro es mensual o anual.')
        return
      }
      amount = parsed
    }
    const limits = featureLimits(drafts)
    if ('invalid' in limits) {
      setIssue(
        `El límite de «${featureName(catalogue, limits.invalid)}» debe ser un número entero, o quedar vacío para no tener límite.`,
      )
      return
    }
    setIssue(null)
    void onPropose({
      amount_minor: amount,
      currency_code: paid ? currency : null,
      billing_period: paid && period !== '' ? period : null,
      features: limits.limits,
    }).then((done) => {
      if (done) setPrice('')
    })
  }

  return (
    <section data-plan-propose>
      <h3>Proponer una versión</h3>
      <form onSubmit={propose} data-plan-propose-form>
        <FieldGroup>
          {paid ? (
            <>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-price`}>Precio</FieldLabel>
                <Input
                  id={`${idPrefix}-price`}
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="39900"
                  disabled={busy !== null}
                />
                <FieldDescription>
                  Sin puntos de miles. Los centavos van después de una coma.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-currency`}>Moneda</FieldLabel>
                <Select
                  items={PLAN_CURRENCIES.map((option) => ({
                    value: option.code,
                    label: option.label,
                  }))}
                  value={currency}
                  onValueChange={(value) => setCurrency(String(value ?? 'COP'))}
                >
                  <SelectTrigger id={`${idPrefix}-currency`} disabled={busy !== null}>
                    <SelectValue>{currencyLabel(currency)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_CURRENCIES.map((option) => (
                      <SelectItem key={option.code} value={option.code}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-period`}>Cobro</FieldLabel>
                <Select
                  items={BILLING_PERIOD_OPTIONS}
                  value={period}
                  onValueChange={(value) =>
                    setPeriod((value ?? '') as PlatformPlanBillingPeriod | '')
                  }
                >
                  <SelectTrigger id={`${idPrefix}-period`} disabled={busy !== null}>
                    <SelectValue placeholder="Mensual o anual" />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : (
            <p data-plan-free-note>
              El plan gratuito cuesta cero y no tiene moneda ni periodo. Lo que cambia en sus
              versiones son sus límites.
            </p>
          )}

          {drafts.length === 0 ? (
            <p data-plan-no-features>
              No hay funciones que limitar todavía, así que esta versión solo define{' '}
              {paid ? 'el precio y el periodo' : 'que el plan existe'}.
            </p>
          ) : (
            drafts.map((draft, index) => (
              <Field key={draft.code} data-plan-feature-draft={draft.code}>
                <FieldTitle>{featureName(catalogue, draft.code)}</FieldTitle>
                <Checkbox
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    update(index, { enabled: checked === true, limit: checked ? draft.limit : '' })
                  }
                  disabled={busy !== null}
                  aria-label={`Incluir ${featureName(catalogue, draft.code)}`}
                >
                  Incluida en este plan
                </Checkbox>
                <Input
                  id={`${idPrefix}-${draft.code}`}
                  aria-label={`Límite de ${featureName(catalogue, draft.code)}`}
                  inputMode="numeric"
                  value={draft.limit}
                  onChange={(event) => update(index, { limit: event.target.value })}
                  placeholder="Sin límite"
                  disabled={busy !== null || !draft.enabled}
                />
              </Field>
            ))
          )}

          {issue ? <FieldError>{issue}</FieldError> : null}
        </FieldGroup>
        <Button type="submit" disabled={busy !== null}>
          Proponer versión
        </Button>
      </form>
    </section>
  )
}
