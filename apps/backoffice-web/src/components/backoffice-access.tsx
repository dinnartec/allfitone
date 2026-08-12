'use client'

import { ProductLockup } from '@allfitone/react/brand'
import {
  AccessDescription,
  AccessEyebrow,
  AccessHeader,
  AccessHero,
  AccessJourney,
  AccessJourneyIndex,
  AccessJourneyLabel,
  AccessJourneyStep,
  AccessMain,
  AccessPanel,
  AccessPanelAction,
  AccessPanelContent,
  AccessPanelDescription,
  AccessPanelEyebrow,
  AccessPanelHeader,
  AccessPanelNote,
  AccessPanelTitle,
  AccessShell,
  AccessTitle,
} from '@allfitone/react/components/access-shell'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  DeviceGate,
  DeviceGateContent,
  DeviceGateDescription,
  DeviceGateEyebrow,
  DeviceGateFallback,
  DeviceGateHeader,
  DeviceGateMain,
  DeviceGateTitle,
  DeviceGateVisual,
} from '@allfitone/react/components/device-gate'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import { Spinner } from '@allfitone/react/components/spinner'
import { FoundationIcon } from '@allfitone/react/icons'
import Image from 'next/image'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import {
  BackofficeApiError,
  backofficeApi,
  newBackofficeCommand,
  type BackofficeAuthenticationAttempt,
  type BackofficeCommand,
  type BackofficeLogoutReason,
  type BackofficeSession,
} from '@/lib/backoffice-api'
import {
  activeSessionActivity,
  BACKOFFICE_HEARTBEAT_INTERVAL_MS,
  backofficeSessionStorageKey,
  clearBackofficeSessionActivity,
  parseBackofficeSessionActivity,
  readBackofficeSessionActivity,
  sessionDeadline,
  writeBackofficeSessionActivity,
  type BackofficeSessionEndReason,
} from '@/lib/session-activity'

type ViewState =
  | { kind: 'checking' }
  | { kind: 'login'; notice?: 'expired' | 'disabled' }
  | { kind: 'enrollment'; attempt: BackofficeAuthenticationAttempt }
  | { kind: 'challenge'; attempt: BackofficeAuthenticationAttempt }
  | { kind: 'reset' }
  | { kind: 'reset-sent' }
  | { kind: 'authenticated'; session: BackofficeSession }
  | { kind: 'unavailable' }
  | {
      kind: 'recovery'
      reason: BackofficeSessionEndReason
      busy: boolean
      retryable: boolean
    }

type RetryResolution = 'attempt-open' | 'expired' | 'recovery' | 'authenticated'

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function BackofficeAccess() {
  const [view, setView] = useState<ViewState>({ kind: 'checking' })
  const viewRef = useRef<ViewState>(view)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const immediateCoverRef = useRef<HTMLDivElement>(null)
  const lifecycleGenerationRef = useRef(0)
  const lastHeartbeatRef = useRef(0)
  const heartbeatInFlightRef = useRef(false)

  const commit = useCallback((next: ViewState): void => {
    viewRef.current = next
    setView(next)
  }, [])

  const coverImmediately = useCallback((): void => {
    surfaceRef.current?.setAttribute('hidden', '')
    immediateCoverRef.current?.removeAttribute('hidden')
  }, [])

  const acceptSession = useCallback(
    (session: BackofficeSession): boolean => {
      const activity = activeSessionActivity({
        inactivityExpiresAt: session.inactivity_expires_at,
        absoluteExpiresAt: session.absolute_expires_at,
      })
      if (!Number.isFinite(sessionDeadline(activity))) {
        commit({ kind: 'recovery', reason: 'unknown', busy: false, retryable: true })
        return false
      }
      lastHeartbeatRef.current = activity.lastVerifiedAt
      writeBackofficeSessionActivity(activity)
      commit({ kind: 'authenticated', session })
      return true
    },
    [commit],
  )

  const commitAttempt = useCallback(
    (attempt: BackofficeAuthenticationAttempt): void => {
      clearBackofficeSessionActivity()
      if (attempt.next === 'totp-enrollment') {
        if (!attempt.enrollment) {
          commit({ kind: 'recovery', reason: 'unknown', busy: false, retryable: true })
          return
        }
        commit({ kind: 'enrollment', attempt })
        return
      }
      commit({ kind: 'challenge', attempt })
    },
    [commit],
  )

  const bootstrap = useCallback(
    async (useImmediateCover = false): Promise<void> => {
      const generation = ++lifecycleGenerationRef.current
      if (useImmediateCover) coverImmediately()
      commit({ kind: 'checking' })
      const [sessionResult, attemptResult] = await Promise.allSettled([
        backofficeApi.session(),
        backofficeApi.attempt(),
      ])
      if (generation !== lifecycleGenerationRef.current) return

      const stored = readBackofficeSessionActivity()
      if (sessionResult.status === 'fulfilled') {
        if (stored?.status === 'ended') {
          commit({
            kind: 'recovery',
            reason: stored.reason,
            busy: false,
            retryable: false,
          })
          return
        }
        acceptSession(sessionResult.value)
        return
      }
      if (!isStatus(sessionResult.reason, 401)) {
        if (stored) {
          commit({
            kind: 'recovery',
            reason: stored.status === 'ended' ? stored.reason : 'unknown',
            busy: false,
            retryable: true,
          })
        } else {
          commit({ kind: 'unavailable' })
        }
        return
      }
      if (stored?.status === 'ended') {
        clearBackofficeSessionActivity()
        commit({ kind: 'login' })
        return
      }
      if (attemptResult.status === 'fulfilled') {
        commitAttempt(attemptResult.value)
        return
      }
      if (isStatus(attemptResult.reason, 401)) {
        clearBackofficeSessionActivity()
        commit({ kind: 'login' })
        return
      }
      if (stored?.status === 'active') {
        clearBackofficeSessionActivity()
        commit({ kind: 'login', notice: 'expired' })
      } else {
        commit({ kind: 'unavailable' })
      }
    },
    [acceptSession, commit, commitAttempt, coverImmediately],
  )

  const completeLogout = useCallback(
    async (reason: BackofficeLogoutReason): Promise<void> => {
      const generation = ++lifecycleGenerationRef.current
      const localReason = logoutLocalReason(reason)
      coverImmediately()
      writeBackofficeSessionActivity({
        version: 1,
        status: 'ended',
        endedAt: Date.now(),
        reason: localReason,
      })
      commit({ kind: 'recovery', reason: localReason, busy: true, retryable: false })
      try {
        await backofficeApi.logout(reason)
        if (generation !== lifecycleGenerationRef.current) return
        writeBackofficeSessionActivity({
          version: 1,
          status: 'ended',
          endedAt: Date.now(),
          reason: localReason,
          confirmedAt: Date.now(),
        })
        commit({ kind: 'login' })
      } catch {
        if (generation !== lifecycleGenerationRef.current) return
        commit({ kind: 'recovery', reason: localReason, busy: false, retryable: true })
      }
    },
    [commit, coverImmediately],
  )

  useLayoutEffect(() => {
    immediateCoverRef.current?.setAttribute('hidden', '')
    surfaceRef.current?.removeAttribute('hidden')
  }, [view])

  useEffect(() => {
    void bootstrap()
    return () => {
      lifecycleGenerationRef.current += 1
    }
  }, [bootstrap])

  useEffect(() => {
    function synchronize(event: StorageEvent): void {
      if (event.key !== backofficeSessionStorageKey) return
      const stored = parseBackofficeSessionActivity(event.newValue)
      if (stored?.status === 'ended') {
        lifecycleGenerationRef.current += 1
        coverImmediately()
        if (stored.confirmedAt !== undefined) {
          commit({ kind: 'login' })
        } else {
          commit({ kind: 'recovery', reason: stored.reason, busy: false, retryable: true })
        }
        return
      }
      if (stored?.status !== 'active') return
      const current = viewRef.current
      if (current.kind === 'authenticated') {
        commit({
          kind: 'authenticated',
          session: {
            ...current.session,
            inactivity_expires_at: new Date(stored.inactivityExpiresAt).toISOString(),
            absolute_expires_at: new Date(stored.absoluteExpiresAt).toISOString(),
          },
        })
      } else {
        void bootstrap(true)
      }
    }

    function revalidateVisibleSession(): void {
      if (document.visibilityState === 'visible' && viewRef.current.kind === 'authenticated') {
        void bootstrap(true)
      }
    }

    function revalidateHistory(event: PageTransitionEvent): void {
      if (event.persisted && viewRef.current.kind === 'authenticated') void bootstrap(true)
    }

    window.addEventListener('storage', synchronize)
    window.addEventListener('pageshow', revalidateHistory)
    document.addEventListener('visibilitychange', revalidateVisibleSession)
    return () => {
      window.removeEventListener('storage', synchronize)
      window.removeEventListener('pageshow', revalidateHistory)
      document.removeEventListener('visibilitychange', revalidateVisibleSession)
    }
  }, [bootstrap, commit, coverImmediately])

  useEffect(() => {
    if (view.kind !== 'authenticated') return
    const activity = activeSessionActivity({
      inactivityExpiresAt: view.session.inactivity_expires_at,
      absoluteExpiresAt: view.session.absolute_expires_at,
    })
    const remaining = sessionDeadline(activity) - Date.now()
    if (remaining <= 0) {
      void completeLogout('inactivity')
      return
    }
    const timeout = window.setTimeout(() => void completeLogout('inactivity'), remaining)
    return () => window.clearTimeout(timeout)
  }, [completeLogout, view])

  useEffect(() => {
    if (view.kind !== 'authenticated') return

    async function recordMeaningfulActivity(): Promise<void> {
      const now = Date.now()
      if (
        heartbeatInFlightRef.current ||
        now - lastHeartbeatRef.current < BACKOFFICE_HEARTBEAT_INTERVAL_MS
      ) {
        return
      }
      const generation = lifecycleGenerationRef.current
      heartbeatInFlightRef.current = true
      lastHeartbeatRef.current = now
      try {
        const session = await backofficeApi.session()
        if (generation === lifecycleGenerationRef.current) acceptSession(session)
      } catch (error) {
        if (generation !== lifecycleGenerationRef.current) return
        coverImmediately()
        if (isStatus(error, 401)) {
          writeBackofficeSessionActivity({
            version: 1,
            status: 'ended',
            endedAt: Date.now(),
            confirmedAt: Date.now(),
            reason: 'unknown',
          })
          commit({ kind: 'login', notice: 'expired' })
        } else {
          commit({ kind: 'recovery', reason: 'unknown', busy: false, retryable: true })
        }
      } finally {
        heartbeatInFlightRef.current = false
      }
    }

    const onActivity = (): void => void recordMeaningfulActivity()
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    window.addEventListener('touchstart', onActivity, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('touchstart', onActivity)
    }
  }, [acceptSession, commit, coverImmediately, view.kind])

  return (
    <>
      <div ref={immediateCoverRef} hidden data-backoffice-immediate-cover>
        <AccessFrame currentStep={1}>
          <CheckingPanel protecting />
        </AccessFrame>
      </div>
      <div ref={surfaceRef} data-backoffice-surface>
        <AccessFrame currentStep={currentJourneyStep(view)}>
          {view.kind === 'checking' ? (
            <CheckingPanel />
          ) : view.kind === 'login' ? (
            <LoginPanel
              {...(view.notice ? { notice: view.notice } : {})}
              onAttempt={commitAttempt}
              onReset={() => commit({ kind: 'reset' })}
            />
          ) : view.kind === 'enrollment' || view.kind === 'challenge' ? (
            <TotpPanel
              attempt={view.attempt}
              onAttempt={commitAttempt}
              onAuthenticated={acceptSession}
              onExpired={() => commit({ kind: 'login', notice: 'expired' })}
              onRecovery={() =>
                commit({ kind: 'recovery', reason: 'unknown', busy: false, retryable: true })
              }
            />
          ) : view.kind === 'reset' ? (
            <PasswordResetPanel
              onCancel={() => commit({ kind: 'login' })}
              onSent={() => commit({ kind: 'reset-sent' })}
            />
          ) : view.kind === 'reset-sent' ? (
            <PasswordResetSentPanel onDone={() => commit({ kind: 'login' })} />
          ) : view.kind === 'authenticated' ? (
            <AuthenticatedPanel
              session={view.session}
              onLogout={() => void completeLogout('manual')}
            />
          ) : view.kind === 'unavailable' ? (
            <UnavailablePanel onRetry={() => void bootstrap()} />
          ) : (
            <RecoveryPanel
              busy={view.busy}
              reason={view.reason}
              retryable={view.retryable}
              onComplete={() => void completeLogout('recovery')}
              onRetry={() => void bootstrap(true)}
            />
          )}
        </AccessFrame>
      </div>
    </>
  )
}

function AccessFrame({ children, currentStep }: { children: ReactNode; currentStep: 1 | 2 | 3 }) {
  return (
    <DeviceGate>
      <DeviceGateFallback aria-labelledby="backoffice-device-gate-title">
        <DeviceGateHeader>
          <ProductLockup
            product="backoffice"
            surface="dark"
            title="Allfit Backoffice"
            width={180}
            height={42}
          />
        </DeviceGateHeader>
        <DeviceGateMain>
          <DeviceGateVisual />
          <DeviceGateEyebrow>Dispositivo no compatible</DeviceGateEyebrow>
          <DeviceGateTitle id="backoffice-device-gate-title">
            Continúa en una pantalla más amplia.
          </DeviceGateTitle>
          <DeviceGateDescription>
            Allfit Backoffice no está disponible en celular. Ábrelo desde una tablet o un
            computador.
          </DeviceGateDescription>
        </DeviceGateMain>
      </DeviceGateFallback>

      <DeviceGateContent>
        <AccessShell>
          <AccessHeader>
            <ProductLockup
              product="backoffice"
              surface="dark"
              title="Allfit Backoffice"
              width={180}
              height={42}
            />
          </AccessHeader>
          <AccessMain>
            <AccessHero>
              <AccessEyebrow>Operación interna</AccessEyebrow>
              <AccessTitle>Control sin atajos.</AccessTitle>
              <AccessDescription>
                El acceso del equipo interno exige identidad verificada, un segundo factor y una
                sesión independiente para cada operación sensible.
              </AccessDescription>
            </AccessHero>
            {children}
            <AccessJourney aria-label="Progreso de autenticación">
              <AccessJourneyStep aria-current={currentStep === 1 ? 'step' : undefined}>
                <AccessJourneyIndex>01</AccessJourneyIndex>
                <AccessJourneyLabel>Credenciales</AccessJourneyLabel>
              </AccessJourneyStep>
              <AccessJourneyStep aria-current={currentStep === 2 ? 'step' : undefined}>
                <AccessJourneyIndex>02</AccessJourneyIndex>
                <AccessJourneyLabel>Autenticador</AccessJourneyLabel>
              </AccessJourneyStep>
              <AccessJourneyStep aria-current={currentStep === 3 ? 'step' : undefined}>
                <AccessJourneyIndex>03</AccessJourneyIndex>
                <AccessJourneyLabel>Sesión AAL2</AccessJourneyLabel>
              </AccessJourneyStep>
            </AccessJourney>
          </AccessMain>
        </AccessShell>
      </DeviceGateContent>
    </DeviceGate>
  )
}

function CheckingPanel({ protecting = false }: { protecting?: boolean }) {
  return (
    <Panel
      eyebrow="Verificación de acceso"
      title={protecting ? 'Protegiendo sesión.' : 'Comprobando sesión.'}
      description={
        protecting
          ? 'El contenido interno permanece desmontado mientras aseguramos el cierre.'
          : 'Estamos comprobando si este navegador conserva una sesión o un desafío pendiente.'
      }
    >
      <Alert icon={<Spinner label="Comprobando acceso" />} live="polite">
        <AlertTitle>{protecting ? 'Contenido protegido' : 'Verificación en curso'}</AlertTitle>
        <AlertDescription>No cierres esta pestaña.</AlertDescription>
      </Alert>
    </Panel>
  )
}

function LoginPanel({
  notice,
  onAttempt,
  onReset,
}: {
  notice?: 'expired' | 'disabled'
  onAttempt: (attempt: BackofficeAuthenticationAttempt) => void
  onReset: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const rateLimit = useRateLimit()

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy || rateLimit.remainingSeconds > 0) return
    const form = new FormData(event.currentTarget)
    const email = form.get('email')
    const password = form.get('password')
    if (typeof email !== 'string' || typeof password !== 'string') return
    setBusy(true)
    setError(undefined)
    try {
      const attempt = await backofficeApi.password(email.trim(), password)
      onAttempt(attempt)
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 401) {
        setError('No pudimos validar el acceso. Revisa tus datos e inténtalo de nuevo.')
      } else if (caught instanceof BackofficeApiError && caught.status === 429) {
        rateLimit.start(caught.retryAfterMs)
        setError('Alcanzaste el límite de intentos. Espera antes de volver a probar.')
      } else if (
        caught instanceof BackofficeApiError &&
        (caught.code === 'service-degraded' || caught.status === 503)
      ) {
        setError('El acceso interno todavía no está habilitado. Puedes reintentar más tarde.')
      } else {
        setError('No pudimos comunicarnos con el servicio de acceso. Reintenta.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      eyebrow="Paso 1 de 3"
      title="Identifica tu acceso."
      description="Usa la cuenta interna asignada por Allfit. La sesión solo se crea después de confirmar tu autenticador."
    >
      {notice === 'expired' ? (
        <Alert live="polite" variant="warning">
          <AlertTitle>El acceso anterior terminó</AlertTitle>
          <AlertDescription>Inicia de nuevo para crear una sesión protegida.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>Acceso no confirmado</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backoffice-email">Correo</FieldLabel>
            <Input
              id="backoffice-email"
              name="email"
              type="email"
              autoComplete="username"
              maxLength={320}
              required
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="backoffice-password">Contraseña</FieldLabel>
            <Input
              id="backoffice-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={4096}
              required
            />
          </Field>
          {rateLimit.remainingSeconds > 0 ? (
            <FieldDescription role="status">
              Podrás reintentar en {rateLimit.remainingSeconds} segundos.
            </FieldDescription>
          ) : null}
          <AccessPanelAction>
            <Button type="submit" disabled={busy || rateLimit.remainingSeconds > 0}>
              {busy ? <Spinner label="Validando credenciales" /> : null}
              {busy ? 'Validando…' : 'Continuar con autenticador'}
            </Button>
          </AccessPanelAction>
          <AccessPanelAction>
            <Button type="button" variant="outline" onClick={onReset}>
              Olvidé mi contraseña
            </Button>
          </AccessPanelAction>
        </FieldGroup>
      </form>
    </Panel>
  )
}

function TotpPanel({
  attempt,
  onAttempt,
  onAuthenticated,
  onExpired,
  onRecovery,
}: {
  attempt: BackofficeAuthenticationAttempt
  onAttempt: (attempt: BackofficeAuthenticationAttempt) => void
  onAuthenticated: (session: BackofficeSession) => boolean
  onExpired: () => void
  onRecovery: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const pendingOperationRef = useRef<{ code: string; command: BackofficeCommand } | undefined>(
    undefined,
  )
  const rateLimit = useRateLimit()
  const enrollment = attempt.next === 'totp-enrollment' ? attempt.enrollment : undefined

  useEffect(() => {
    const remaining = Date.parse(attempt.expires_at) - Date.now()
    if (remaining <= 0) {
      onExpired()
      return
    }
    const timeout = window.setTimeout(onExpired, remaining)
    return () => window.clearTimeout(timeout)
  }, [attempt.expires_at, onExpired])

  async function resolveIndeterminate(): Promise<RetryResolution> {
    try {
      const session = await backofficeApi.session()
      onAuthenticated(session)
      return 'authenticated'
    } catch (sessionError) {
      if (!isStatus(sessionError, 401)) {
        onRecovery()
        return 'recovery'
      }
    }
    try {
      const currentAttempt = await backofficeApi.attempt()
      onAttempt(currentAttempt)
      return 'attempt-open'
    } catch (attemptError) {
      if (isStatus(attemptError, 401)) {
        onExpired()
        return 'expired'
      }
      onRecovery()
      return 'recovery'
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy || rateLimit.remainingSeconds > 0 || !/^\d{6}$/.test(code)) return
    const existing = pendingOperationRef.current
    const operation = existing?.code === code ? existing : { code, command: newBackofficeCommand() }
    pendingOperationRef.current = operation
    setBusy(true)
    setError(undefined)
    try {
      await backofficeApi.verifyTotp(operation.code, operation.command)
      const session = await backofficeApi.session()
      pendingOperationRef.current = undefined
      onAuthenticated(session)
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 429) {
        rateLimit.start(caught.retryAfterMs)
        setError('Alcanzaste el límite temporal. Conservaremos este intento para reintentarlo.')
      } else if (caught instanceof BackofficeApiError && caught.status === 401) {
        pendingOperationRef.current = undefined
        try {
          const currentAttempt = await backofficeApi.attempt()
          onAttempt(currentAttempt)
          setCode('')
          setError('El código no fue válido. Usa el código actual de tu autenticador.')
        } catch (attemptError) {
          if (isStatus(attemptError, 401)) onExpired()
          else onRecovery()
        }
      } else if (caught instanceof BackofficeApiError && caught.status === 409) {
        pendingOperationRef.current = undefined
        const resolution = await resolveIndeterminate()
        if (resolution === 'attempt-open') onExpired()
      } else {
        const resolution = await resolveIndeterminate()
        if (resolution === 'attempt-open') {
          setError('No pudimos confirmar el resultado. Reintenta el mismo código de forma segura.')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function copyManualKey(): Promise<void> {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.manual_key)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Panel
      eyebrow="Paso 2 de 3"
      title={enrollment ? 'Conecta tu autenticador.' : 'Confirma el código.'}
      description={
        enrollment
          ? 'Escanea el QR o registra la clave manual. Después escribe el código de seis dígitos.'
          : 'Escribe el código vigente de seis dígitos que muestra tu autenticador.'
      }
    >
      {enrollment ? (
        <Card size="sm">
          <Image
            src={enrollment.qr_code}
            alt="Código QR para enlazar el autenticador"
            width={180}
            height={180}
            unoptimized
          />
          <CardHeader>
            <CardTitle>Alternativa manual</CardTitle>
            <CardDescription>Usa esta clave si no puedes escanear el QR.</CardDescription>
            <CardAction>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void copyManualKey()}
              >
                Copiar clave
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="backoffice-manual-key">Clave del autenticador</FieldLabel>
              <Input
                id="backoffice-manual-key"
                value={enrollment.manual_key}
                readOnly
                autoComplete="off"
              />
              <FieldDescription role="status">
                {copied ? 'Clave copiada.' : 'La clave solo se conserva durante este intento.'}
              </FieldDescription>
            </Field>
          </CardContent>
        </Card>
      ) : null}
      {error ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>Código no confirmado</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <Field data-invalid={code.length > 0 && code.length !== 6}>
            <FieldLabel htmlFor="backoffice-totp">Código de seis dígitos</FieldLabel>
            <Input
              id="backoffice-totp"
              name="code"
              value={code}
              onChange={(event) =>
                setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              autoFocus={!enrollment}
              aria-invalid={code.length > 0 && code.length !== 6}
            />
            {code.length > 0 && code.length !== 6 ? (
              <FieldError>El código debe tener seis dígitos.</FieldError>
            ) : null}
            <FieldDescription>
              El intento vence el {formatDate(attempt.expires_at)}.
            </FieldDescription>
          </Field>
          {rateLimit.remainingSeconds > 0 ? (
            <FieldDescription role="status">
              Podrás reintentar en {rateLimit.remainingSeconds} segundos.
            </FieldDescription>
          ) : null}
          <AccessPanelAction>
            <Button
              type="submit"
              disabled={busy || code.length !== 6 || rateLimit.remainingSeconds > 0}
            >
              {busy ? <Spinner label="Confirmando código" /> : null}
              {busy ? 'Confirmando…' : 'Verificar y entrar'}
            </Button>
          </AccessPanelAction>
        </FieldGroup>
      </form>
    </Panel>
  )
}

function PasswordResetPanel({ onCancel, onSent }: { onCancel: () => void; onSent: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const rateLimit = useRateLimit()

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy || rateLimit.remainingSeconds > 0) return
    const email = new FormData(event.currentTarget).get('email')
    if (typeof email !== 'string') return
    setBusy(true)
    setError(undefined)
    try {
      await backofficeApi.passwordReset(email.trim())
      onSent()
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.status === 429) {
        rateLimit.start(caught.retryAfterMs)
        setError('Alcanzaste el límite de solicitudes. Espera antes de reintentar.')
      } else {
        setError('No pudimos enviar la solicitud. Revisa tu conexión y reintenta.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      eyebrow="Recuperación de acceso"
      title="Restablece tu contraseña."
      description="Indica tu correo interno. WorkOS enviará las instrucciones desde su página segura alojada."
    >
      {error ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>Solicitud no enviada</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={(event) => void submit(event)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backoffice-reset-email">Correo</FieldLabel>
            <Input
              id="backoffice-reset-email"
              name="email"
              type="email"
              autoComplete="username"
              maxLength={320}
              required
              autoFocus
            />
          </Field>
          {rateLimit.remainingSeconds > 0 ? (
            <FieldDescription role="status">
              Podrás reintentar en {rateLimit.remainingSeconds} segundos.
            </FieldDescription>
          ) : null}
          <AccessPanelAction>
            <Button type="submit" disabled={busy || rateLimit.remainingSeconds > 0}>
              {busy ? <Spinner label="Solicitando recuperación" /> : null}
              {busy ? 'Enviando…' : 'Enviar instrucciones'}
            </Button>
          </AccessPanelAction>
          <AccessPanelAction>
            <Button type="button" variant="outline" onClick={onCancel}>
              Volver al acceso
            </Button>
          </AccessPanelAction>
        </FieldGroup>
      </form>
    </Panel>
  )
}

function PasswordResetSentPanel({ onDone }: { onDone: () => void }) {
  return (
    <Panel
      eyebrow="Recuperación solicitada"
      title="Revisa tu correo."
      description="La respuesta es la misma para todas las direcciones y no confirma si existe una cuenta."
    >
      <Alert live="polite" variant="success">
        <AlertTitle>Solicitud recibida</AlertTitle>
        <AlertDescription>
          Si existe una cuenta, recibirás instrucciones para restablecer la contraseña.
        </AlertDescription>
      </Alert>
      <AccessPanelAction>
        <Button type="button" onClick={onDone}>
          Volver al acceso
        </Button>
      </AccessPanelAction>
    </Panel>
  )
}

function AuthenticatedPanel({
  session,
  onLogout,
}: {
  session: BackofficeSession
  onLogout: () => void
}) {
  const operatorName = `${session.operator.given_name} ${session.operator.family_name}`.trim()
  return (
    <Panel
      eyebrow="Paso 3 de 3"
      title="Acceso confirmado."
      description={`La identidad de ${operatorName} fue verificada. Los módulos operativos se habilitarán con sus deberes específicos.`}
    >
      <Alert live="polite" variant="success">
        <AlertTitle>Nivel AAL2 comprobado</AlertTitle>
        <AlertDescription>Contraseña y código TOTP vinculados a esta sesión.</AlertDescription>
      </Alert>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Sesión actual</CardTitle>
          <CardDescription>La sesión no concede operaciones por sí sola.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldContent>
                <FieldTitle>Operador</FieldTitle>
                <FieldDescription>{operatorName}</FieldDescription>
              </FieldContent>
            </Field>
            <Field>
              <FieldContent>
                <FieldTitle>Evidencia</FieldTitle>
                <FieldDescription>
                  AAL2 · verificada el {formatDate(session.assurance_verified_at)}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Field>
              <FieldContent>
                <FieldTitle>Inactividad</FieldTitle>
                <FieldDescription>
                  Vence el {formatDate(session.inactivity_expires_at)}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Field>
              <FieldContent>
                <FieldTitle>Límite absoluto</FieldTitle>
                <FieldDescription>
                  Vence el {formatDate(session.absolute_expires_at)}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <AccessPanelAction>
        <Button type="button" variant="outline" onClick={onLogout}>
          Cerrar sesión
        </Button>
      </AccessPanelAction>
    </Panel>
  )
}

function RecoveryPanel({
  busy,
  reason,
  retryable,
  onComplete,
  onRetry,
}: {
  busy: boolean
  reason: BackofficeSessionEndReason
  retryable: boolean
  onComplete: () => void
  onRetry: () => void
}) {
  return (
    <Panel
      eyebrow="Sesión protegida"
      title="Tu sesión está protegida."
      description={
        reason === 'inactivity'
          ? 'El tiempo de inactividad terminó. Completa el cierre antes de volver a autenticarte.'
          : 'No mostraremos información interna hasta confirmar el estado seguro de la sesión.'
      }
    >
      <Alert live="polite" variant="warning">
        <AlertTitle>{busy ? 'Completando cierre' : 'Contenido interno desmontado'}</AlertTitle>
        <AlertDescription>
          {busy
            ? 'Estamos revocando la sesión local y su vínculo externo.'
            : 'Puedes completar el cierre o volver a comprobar el servicio.'}
        </AlertDescription>
      </Alert>
      <AccessPanelAction>
        <Button type="button" disabled={busy} onClick={onComplete}>
          {busy ? <Spinner label="Completando cierre" /> : null}
          {busy ? 'Completando…' : 'Completar cierre'}
        </Button>
      </AccessPanelAction>
      {retryable ? (
        <AccessPanelAction>
          <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>
            Reintentar
          </Button>
        </AccessPanelAction>
      ) : null}
    </Panel>
  )
}

function UnavailablePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel
      eyebrow="Servicio de acceso"
      title="No pudimos comprobar el acceso."
      description="Backoffice no logró comunicarse con el servicio de autenticación. No hay una sesión confirmada ni contenido interno visible."
    >
      <Alert live="polite" variant="warning">
        <AlertTitle>El servicio no respondió</AlertTitle>
        <AlertDescription>
          Comprueba que la API esté disponible y vuelve a intentarlo. No necesitas cerrar ninguna
          sesión.
        </AlertDescription>
      </Alert>
      <AccessPanelAction>
        <Button type="button" onClick={onRetry}>
          Volver a comprobar
        </Button>
      </AccessPanelAction>
    </Panel>
  )
}

function Panel({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <AccessPanel>
      <AccessPanelHeader>
        <AccessPanelEyebrow>{eyebrow}</AccessPanelEyebrow>
        <AccessPanelTitle>{title}</AccessPanelTitle>
        <AccessPanelDescription>{description}</AccessPanelDescription>
      </AccessPanelHeader>
      <AccessPanelContent>{children}</AccessPanelContent>
      <AccessPanelNote>
        <FoundationIcon name="permissions" decorative />
        Acceso exclusivo para el equipo autorizado de Allfit.
      </AccessPanelNote>
    </AccessPanel>
  )
}

function useRateLimit(): { remainingSeconds: number; start: (duration?: number) => void } {
  const [until, setUntil] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  useEffect(() => {
    if (until <= Date.now()) {
      setRemainingSeconds(0)
      return
    }
    function update(): void {
      setRemainingSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    }
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [until])

  return {
    remainingSeconds,
    start: (duration = 60_000) => setUntil(Date.now() + duration),
  }
}

function currentJourneyStep(view: ViewState): 1 | 2 | 3 {
  if (view.kind === 'enrollment' || view.kind === 'challenge') return 2
  if (view.kind === 'authenticated') return 3
  return 1
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof BackofficeApiError && error.status === status
}

function logoutLocalReason(reason: BackofficeLogoutReason): BackofficeSessionEndReason {
  if (reason === 'manual' || reason === 'inactivity') return reason
  return 'unknown'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? DATE_FORMAT.format(date) : 'fecha no disponible'
}
