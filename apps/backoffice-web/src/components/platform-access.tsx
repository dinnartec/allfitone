'use client'

/**
 * `HU-BO-029` — who on the team reaches the data — and `HU-BO-028` — granting and
 * withdrawing that reach. They are one screen because they are one question: an
 * operator cannot administer access sensibly without seeing it first.
 *
 * The administration controls are always offered, never hidden behind what the
 * inventory says the operator holds. That is deliberate. The inventory is
 * evidence, and using it to decide what to render would turn it into an
 * authorization cache — exactly what the story forbids. Every action is
 * attempted and the API answers from its own transaction, so a duty that expires
 * mid-session fails the next command instead of the next render.
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
  TableState,
} from '@allfitone/react/components/table'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  newBackofficeCommand,
  type PlatformDutyAssignment,
  type PlatformDutyCode,
  type PlatformRoleAssignment,
} from '@/lib/backoffice-api'
import {
  DEFAULT_DUTY_DAYS,
  MAX_DUTY_DAYS,
  PLATFORM_DUTY_CODES,
  dutyExpiryFromDays,
  dutyLabel,
  dutyStatusLabel,
  dutyStatusTone,
  formatInstant,
  isDutyClosed,
  isValidDutyDays,
  isValidPersonId,
  isValidReasonCode,
  platformAccessMessage,
  roleStatusLabel,
  roleStatusTone,
} from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

interface Inventory {
  roles: PlatformRoleAssignment[]
  roleCursor: string | null
  duties: PlatformDutyAssignment[]
  dutyCursor: string | null
}

const EMPTY: Inventory = { roles: [], roleCursor: null, duties: [], dutyCursor: null }

export function PlatformAccess() {
  const [state, setState] = useState<LoadState>('loading')
  const [inventory, setInventory] = useState<Inventory>(EMPTY)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [appending, setAppending] = useState<'roles' | 'duties' | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [roles, duties] = await Promise.all([
        backofficeApi.platformRoles(undefined, signal),
        backofficeApi.platformDuties({}, signal),
      ])
      setInventory({
        roles: roles.data,
        roleCursor: roles.page.next_cursor,
        duties: duties.data,
        dutyCursor: duties.page.next_cursor,
      })
      setState('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      setState(error instanceof BackofficeApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
    }
  }, [load])

  /**
   * The inventory answers a page at a time. Showing only the first one would
   * tell the founder that it is the whole team, which is the opposite of what
   * this screen is for, so the rest is reachable and the button says so.
   */
  async function loadMore(which: 'roles' | 'duties') {
    const cursor = which === 'roles' ? inventory.roleCursor : inventory.dutyCursor
    if (!cursor) return
    setAppending(which)
    setNotice(null)
    try {
      if (which === 'roles') {
        const page = await backofficeApi.platformRoles(cursor)
        setInventory((current) => ({
          ...current,
          roles: [...current.roles, ...page.data],
          roleCursor: page.page.next_cursor,
        }))
      } else {
        const page = await backofficeApi.platformDuties({ cursor })
        setInventory((current) => ({
          ...current,
          duties: [...current.duties, ...page.data],
          dutyCursor: page.page.next_cursor,
        }))
      }
    } catch (error) {
      setNotice({ tone: 'danger', message: failureMessage(error) })
    } finally {
      setAppending(null)
    }
  }

  const run = useCallback(
    async (operation: () => Promise<unknown>, success: string) => {
      setBusy(true)
      setNotice(null)
      try {
        await operation()
        await load()
        setNotice({ tone: 'success', message: success })
      } catch (error) {
        setNotice({ tone: 'danger', message: failureMessage(error) })
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  if (state === 'loading') {
    return (
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Equipo de Allfit
          </CardTitle>
          <CardDescription>Cargando el inventario de acceso.</CardDescription>
        </CardHeader>
        <CardContent>
          <Spinner />
        </CardContent>
      </Card>
    )
  }

  if (state === 'forbidden') {
    return (
      <Alert live="polite" variant="warning">
        <AlertTitle>No puedes ver este inventario</AlertTitle>
        <AlertDescription>
          Consultarlo exige un deber vigente de administración o de auditoría de accesos, con AAL2.
          El rol base por sí solo no alcanza.
        </AlertDescription>
      </Alert>
    )
  }

  if (state === 'error') {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo cargar el inventario</AlertTitle>
        <AlertDescription>
          El servicio no respondió.{' '}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-platform-access>
      {notice ? (
        <Alert live="polite" variant={notice.tone === 'success' ? 'success' : 'danger'}>
          <AlertTitle>{notice.tone === 'success' ? 'Hecho' : 'No se aplicó'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <BaseRoleSection
        assignments={inventory.roles}
        busy={busy}
        hasMore={inventory.roleCursor !== null}
        appending={appending === 'roles'}
        onLoadMore={() => void loadMore('roles')}
        onGrant={(personId) =>
          run(
            () => backofficeApi.grantPlatformRole(personId, newBackofficeCommand()),
            'Rol base otorgado.',
          )
        }
        onRevoke={(assignmentId) =>
          run(
            () => backofficeApi.revokePlatformRole(assignmentId, newBackofficeCommand()),
            'Rol base retirado. Se cerraron sus deberes y su sesión.',
          )
        }
      />

      <DutySection
        assignments={inventory.duties}
        busy={busy}
        hasMore={inventory.dutyCursor !== null}
        appending={appending === 'duties'}
        onLoadMore={() => void loadMore('duties')}
        onGrant={(input) =>
          run(
            () => backofficeApi.grantPlatformDuty(input, newBackofficeCommand()),
            'Deber otorgado.',
          )
        }
        onSuspend={(assignmentId) =>
          run(
            () => backofficeApi.suspendPlatformDuty(assignmentId, newBackofficeCommand()),
            'Deber suspendido. Deja de autorizar desde la próxima transacción.',
          )
        }
        onRevoke={(assignmentId) =>
          run(
            () => backofficeApi.revokePlatformDuty(assignmentId, newBackofficeCommand()),
            'Deber revocado.',
          )
        }
      />
    </div>
  )
}

function BaseRoleSection({
  assignments,
  busy,
  hasMore,
  appending,
  onLoadMore,
  onGrant,
  onRevoke,
}: {
  assignments: PlatformRoleAssignment[]
  busy: boolean
  hasMore: boolean
  appending: boolean
  onLoadMore: () => void
  onGrant: (personId: string) => void
  onRevoke: (assignmentId: string) => void
}) {
  const [personId, setPersonId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!isValidPersonId(personId)) {
      setError('Escribe el identificador de la persona.')
      return
    }
    setError(null)
    setPersonId('')
    onGrant(personId)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Rol base
        </CardTitle>
        <CardDescription>
          `allfit_admin` permite iniciar sesión y nada más. No concede ninguna operación sin un
          deber vigente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} data-platform-form noValidate>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="platform-role-person">Persona que recibe el rol</FieldLabel>
              <Input
                id="platform-role-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                placeholder="019a3000-0000-7000-8000-000000000001"
                autoComplete="off"
                disabled={busy}
              />
              <Button type="submit" disabled={busy}>
                Otorgar rol base
              </Button>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>

        <Table scrollAreaLabel="Asignaciones de rol base">
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Otorgó</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Retirado</TableHead>
              <TableHead align="end">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.length === 0 ? (
              <TableRow>
                <TableState
                  colSpan={6}
                  state="empty"
                  title="Nadie tiene rol base"
                  description="Sólo la ceremonia de arranque puede crear los primeros dos administradores."
                />
              </TableRow>
            ) : (
              assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <code>{assignment.person_id}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={roleStatusTone(assignment.status)}>
                      {roleStatusLabel(assignment.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code>{assignment.granted_by_person_id}</code>
                  </TableCell>
                  <TableCell>{formatInstant(assignment.granted_at)}</TableCell>
                  <TableCell>{formatInstant(assignment.revoked_at)}</TableCell>
                  <TableCell align="end">
                    {assignment.status === 'active' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => onRevoke(assignment.id)}
                      >
                        Retirar
                      </Button>
                    ) : (
                      <span>—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <LoadMore
          label="Ver más asignaciones de rol base"
          hasMore={hasMore}
          appending={appending}
          onLoadMore={onLoadMore}
        />
      </CardContent>
    </Card>
  )
}

function DutySection({
  assignments,
  busy,
  hasMore,
  appending,
  onLoadMore,
  onGrant,
  onSuspend,
  onRevoke,
}: {
  assignments: PlatformDutyAssignment[]
  busy: boolean
  hasMore: boolean
  appending: boolean
  onLoadMore: () => void
  onGrant: (input: {
    personId: string
    dutyCode: PlatformDutyCode
    validTo: string
    reasonCode: string
  }) => void
  onSuspend: (assignmentId: string) => void
  onRevoke: (assignmentId: string) => void
}) {
  const [personId, setPersonId] = useState('')
  const [dutyCode, setDutyCode] = useState<PlatformDutyCode>('diagnose_support_metadata')
  const [days, setDays] = useState(String(DEFAULT_DUTY_DAYS))
  const [reasonCode, setReasonCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsedDays = Number(days)
    if (!isValidPersonId(personId)) {
      setError('Escribe el identificador de la persona.')
      return
    }
    if (!isValidDutyDays(parsedDays)) {
      setError(`La vigencia va de 1 a ${MAX_DUTY_DAYS} días.`)
      return
    }
    if (!isValidReasonCode(reasonCode)) {
      setError('La referencia sólo admite letras, números y . _ : - y espacios.')
      return
    }
    setError(null)
    setPersonId('')
    setReasonCode('')
    onGrant({
      personId,
      dutyCode,
      validTo: dutyExpiryFromDays(parsedDays),
      reasonCode,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Deberes de plataforma
        </CardTitle>
        <CardDescription>
          Cada deber es temporal, exige AAL2 y lo otorga otra persona. Vencer, suspender o revocar
          corta sus operaciones en la siguiente transacción.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} data-platform-form noValidate>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="platform-duty-person">Persona que recibe el deber</FieldLabel>
              <Input
                id="platform-duty-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                placeholder="019a3000-0000-7000-8000-000000000001"
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="platform-duty-code">Deber</FieldLabel>
              <Select
                value={dutyCode}
                onValueChange={(value) => setDutyCode(value as PlatformDutyCode)}
              >
                <SelectTrigger id="platform-duty-code" disabled={busy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_DUTY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {dutyLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="platform-duty-days">Vigencia en días</FieldLabel>
              <Input
                id="platform-duty-days"
                type="number"
                min={1}
                max={MAX_DUTY_DAYS}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="platform-duty-reason">Referencia</FieldLabel>
              <Input
                id="platform-duty-reason"
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                placeholder="CASE-2026-014"
                autoComplete="off"
                disabled={busy}
              />
              <Button type="submit" disabled={busy}>
                Otorgar deber
              </Button>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>

        <Table scrollAreaLabel="Asignaciones de deber">
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Deber</TableHead>
              <TableHead>Modo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>AAL</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Otorgó</TableHead>
              <TableHead>Recertificado</TableHead>
              <TableHead align="end">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.length === 0 ? (
              <TableRow>
                <TableState
                  colSpan={9}
                  state="empty"
                  title="Nadie tiene deberes vigentes"
                  description="Sin un deber, quien tenga rol base puede entrar pero no ejecutar nada."
                />
              </TableRow>
            ) : (
              assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <code>{assignment.person_id}</code>
                  </TableCell>
                  <TableCell>{dutyLabel(assignment.duty_code)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{assignment.actor_mode}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={dutyStatusTone(assignment.status)}>
                      {dutyStatusLabel(assignment.status)}
                    </Badge>
                  </TableCell>
                  <TableCell numeric>{assignment.required_aal}</TableCell>
                  <TableCell>
                    {formatInstant(assignment.valid_from)} → {formatInstant(assignment.valid_to)}
                  </TableCell>
                  <TableCell>
                    <code>{assignment.granted_by_person_id}</code>
                  </TableCell>
                  <TableCell>{formatInstant(assignment.recertified_at)}</TableCell>
                  <TableCell align="end">
                    {isDutyClosed(assignment.status) ? (
                      <span>—</span>
                    ) : (
                      <>
                        {assignment.status !== 'suspended' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onSuspend(assignment.id)}
                          >
                            Suspender
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => onRevoke(assignment.id)}
                        >
                          Revocar
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <LoadMore
          label="Ver más deberes"
          hasMore={hasMore}
          appending={appending}
          onLoadMore={onLoadMore}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Absent when there is nothing left, so its presence is the honest signal that
 * the list on screen is not the whole history.
 */
function LoadMore({
  label,
  hasMore,
  appending,
  onLoadMore,
}: {
  label: string
  hasMore: boolean
  appending: boolean
  onLoadMore: () => void
}) {
  if (!hasMore) return null
  return (
    <Button type="button" variant="outline" size="sm" disabled={appending} onClick={onLoadMore}>
      {appending ? 'Cargando…' : label}
    </Button>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return platformAccessMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return platformAccessMessage(error.code)
  return platformAccessMessage('upstream-unavailable')
}
