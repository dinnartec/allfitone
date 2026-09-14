'use client'

/**
 * `HU-BO-012` — finding a gym and seeing whether it operates.
 *
 * Three decisions, and none of them is layout.
 *
 * **Unclaimed is told apart, not merely labelled.** An organization Allfit created
 * for a sale exists but does not operate until its owner accepts. It carries its
 * own state, tone and meaning, so it never reads as a working gym that is quiet.
 *
 * **An unknown count is not zero.** People served is counted from service
 * relationships, which do not exist yet. The column says so rather than printing a
 * zero that would claim the gym serves nobody.
 *
 * **Nothing here identifies a person.** The directory is organizations only: no
 * legal name — for an independent professional it is a person's name — and no
 * owner. Who owns a gym belongs to its file, not to a list anyone may scroll.
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
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type BackofficeOrganizationSummary,
} from '@/lib/backoffice-api'
import {
  EMPTY_DIRECTORY_FILTERS,
  ORGANIZATION_STATUSES,
  PEOPLE_SERVED_NOTE,
  directoryAnswer,
  directoryFilterIssue,
  directoryFilterIssueMessage,
  directoryMessage,
  hasUnknownPeopleServed,
  peopleServedLabel,
  statusLabel,
  statusMeaning,
  statusTone,
  toDirectoryQuery,
  type DirectoryFilters,
  type OrganizationStatus,
} from '@/lib/organization-directory'
import { formatInstant } from '@/lib/platform-access'

type LoadState = 'loading' | 'ready' | 'failed'

const ANY = 'any'

export function OrganizationDirectory() {
  const [state, setState] = useState<LoadState>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<BackofficeOrganizationSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [appending, setAppending] = useState(false)
  const [appendFailure, setAppendFailure] = useState<string | null>(null)
  const [draft, setDraft] = useState<DirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const [applied, setApplied] = useState<DirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const [issue, setIssue] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const page = await backofficeApi.organizations(toDirectoryQuery(applied), controller.signal)
        setOrganizations(page.data)
        setCursor(page.page.next_cursor)
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
  }, [applied])

  function submit(event: FormEvent) {
    event.preventDefault()
    const broken = directoryFilterIssue(draft)
    if (broken) {
      setIssue(directoryFilterIssueMessage(broken))
      return
    }
    setIssue(null)
    setAppendFailure(null)
    setState('loading')
    setApplied({ query: draft.query.trim(), status: draft.status })
  }

  async function loadMore() {
    if (!cursor) return
    setAppending(true)
    setAppendFailure(null)
    try {
      const page = await backofficeApi.organizations(toDirectoryQuery(applied, cursor))
      setOrganizations((current) => [...current, ...page.data])
      setCursor(page.page.next_cursor)
    } catch (error) {
      if (error instanceof BackofficeApiError && error.status === 401) {
        window.location.assign('/')
        return
      }
      setAppendFailure(failureMessage(error))
    } finally {
      setAppending(false)
    }
  }

  return (
    <div data-organization-directory>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Buscar un gimnasio
          </CardTitle>
          <CardDescription>
            Por su nombre visible. El directorio muestra organizaciones, nunca personas: ni la razón
            social ni quién es su dueño.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} data-organization-directory-filters noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="org-query">Nombre</FieldLabel>
                <Input
                  id="org-query"
                  type="search"
                  value={draft.query}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, query: event.target.value }))
                  }
                  placeholder="Gimnasio Norte"
                  autoComplete="off"
                  disabled={state === 'loading'}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="org-status">Estado</FieldLabel>
                <Select
                  value={draft.status}
                  onValueChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      status: (next ?? ANY) as OrganizationStatus | typeof ANY,
                    }))
                  }
                >
                  <SelectTrigger id="org-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Todos</SelectItem>
                    {ORGANIZATION_STATUSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {statusLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {issue ? <FieldError>{issue}</FieldError> : null}
              <Button type="submit" disabled={state === 'loading'}>
                Buscar
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Link href="/organizations/new" data-organization-create-link>
        Crear un gimnasio para una venta
      </Link>

      {state === 'loading' ? <Spinner /> : null}

      {state === 'failed' ? (
        <Alert live="assertive" variant="danger">
          <AlertTitle>No se pudo leer el directorio</AlertTitle>
          <AlertDescription>{failure ?? directoryMessage('upstream-unavailable')}</AlertDescription>
        </Alert>
      ) : null}

      {state === 'ready' ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Gimnasios
            </CardTitle>
            <CardDescription>
              «Sin reclamar» es un gimnasio que Allfit creó y cuyo dueño todavía no aceptó: existe,
              pero no opera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert live="polite" variant="info" data-organization-directory-answer>
              <AlertTitle>Resultado</AlertTitle>
              <AlertDescription>
                {directoryAnswer(organizations.length, cursor !== null, applied)}
              </AlertDescription>
            </Alert>

            {organizations.length > 0 ? (
              <Table scrollAreaLabel="Gimnasios">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Personas que atiende</TableHead>
                    <TableHead>Equipo activo</TableHead>
                    <TableHead>Sedes</TableHead>
                    <TableHead>Creado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations.map((organization) => (
                    <TableRow
                      key={organization.organization_id}
                      data-organization-row
                      data-status={organization.status}
                    >
                      <TableCell>
                        {/* A gym nobody has claimed opens on its handover; any other on its file. */}
                        <Link
                          href={
                            organization.status === 'unclaimed' ||
                            organization.status === 'cancelled'
                              ? `/organizations/${organization.organization_id}/handover`
                              : `/organizations/${organization.organization_id}`
                          }
                          data-handover-link
                        >
                          {organization.display_name}
                        </Link>
                      </TableCell>
                      <TableCell>{organization.type_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={statusTone(organization.status)}
                          title={statusMeaning(organization.status)}
                        >
                          {statusLabel(organization.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{peopleServedLabel(organization.people_served)}</TableCell>
                      <TableCell>{organization.active_member_count}</TableCell>
                      <TableCell>{organization.site_count}</TableCell>
                      <TableCell>{formatInstant(organization.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}

            {hasUnknownPeopleServed(organizations) ? (
              <Alert live="off" variant="info" data-organization-people-served-note>
                <AlertTitle>Por qué no hay cifra de personas atendidas</AlertTitle>
                <AlertDescription>{PEOPLE_SERVED_NOTE}</AlertDescription>
              </Alert>
            ) : null}

            {appendFailure ? (
              <Alert live="assertive" variant="danger">
                <AlertTitle>No se pudieron cargar más gimnasios</AlertTitle>
                <AlertDescription>{appendFailure}</AlertDescription>
              </Alert>
            ) : null}

            {cursor ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={appending}
                onClick={() => void loadMore()}
              >
                {appending ? 'Cargando…' : 'Ver más gimnasios'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return directoryMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return directoryMessage(error.code)
  return directoryMessage('upstream-unavailable')
}
