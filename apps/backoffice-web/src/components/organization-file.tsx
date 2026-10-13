'use client'

/**
 * `HU-BO-013` — a gym's file: its data, its owner, its sites and its team.
 *
 * Three decisions, and none of them is layout.
 *
 * **People are identifiers.** The owner and the team come without names, as ordinary
 * support reads them. Opening one person's card needs the case that justifies it, so
 * the member links appear only once a traceable case reference is written, and the
 * screen says why before anyone looks for a name.
 *
 * **Withheld and unknown are said as such.** A natural person's site address is
 * reserved because it can be their home, and people served, plans, the payment method
 * and Premium are listed as not yet stored by Allfit rather than as empty.
 *
 * **A gym that never had an owner is handed over, not run.** Its file offers the way
 * to its handover and nothing that would act on the gym itself.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Field, FieldGroup, FieldLabel } from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
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
import { useEffect, useState } from 'react'

import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type BackofficeOrganizationFile,
} from '@/lib/backoffice-api'
import { statusLabel, statusTone } from '@/lib/organization-directory'
import {
  IDENTIFIERS_NOTE,
  NO_PLANS_NOTE,
  paymentMethodLine,
  planLine,
  premiumLine,
  fileMessage,
  handsOverHere,
  memberCardHref,
  responsibleLabel,
  rolesLabel,
  siteAddress,
  peopleServedSentence,
  teamSentence,
} from '@/lib/organization-file'
import { formatInstant } from '@/lib/platform-access'

import { OrganizationClientInvitations } from './organization-client-invitations'
import { OrganizationTeamInvitations } from './organization-team-invitations'

type LoadState = 'loading' | 'ready' | 'failed'

export function OrganizationFile({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState<LoadState>('loading')
  const [file, setFile] = useState<BackofficeOrganizationFile | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [caseReference, setCaseReference] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setFile(await backofficeApi.organizationFile(organizationId, controller.signal))
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
  }, [organizationId])

  if (state === 'loading') return <Spinner />

  if (state === 'failed' || !file) {
    return (
      <div data-organization-file>
        <Alert live="assertive" variant="danger">
          <AlertTitle>No se pudo abrir la ficha</AlertTitle>
          <AlertDescription>{failure ?? fileMessage('upstream-unavailable')}</AlertDescription>
        </Alert>
        <Link href="/organizations" data-handover-link>
          Volver al directorio
        </Link>
      </div>
    )
  }

  const organization = file.organization
  const ownerHref = file.owner ? memberCardHref(file.owner.person_id, caseReference) : undefined

  return (
    <div data-organization-file>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {organization.display_name}
          </CardTitle>
          <CardDescription>{organization.type_name}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="file-status">Estado</FieldLabel>
              <Badge id="file-status" variant={statusTone(organization.status)}>
                {statusLabel(organization.status)}
              </Badge>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="file-responsible">Quién responde</FieldLabel>
              <span id="file-responsible">{responsibleLabel(file)}</span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="file-created">Creado</FieldLabel>
              <span id="file-created">{formatInstant(organization.created_at)}</span>
            </Field>
            {organization.claimed_at ? (
              <Field orientation="responsive">
                <FieldLabel htmlFor="file-claimed">Reclamado</FieldLabel>
                <span id="file-claimed">{formatInstant(organization.claimed_at)}</span>
              </Field>
            ) : null}
            {organization.cancelled_at ? (
              <Field orientation="responsive">
                <FieldLabel htmlFor="file-cancelled">Cancelado</FieldLabel>
                <span id="file-cancelled">{formatInstant(organization.cancelled_at)}</span>
              </Field>
            ) : null}
          </FieldGroup>
          {handsOverHere(file) ? (
            <Link
              href={`/organizations/${organization.organization_id}/handover`}
              data-handover-link
            >
              Ver la entrega a su dueño
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Dueño y equipo
          </CardTitle>
          <CardDescription>{IDENTIFIERS_NOTE}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="file-case">Referencia de caso para abrir una persona</FieldLabel>
              <Input
                id="file-case"
                value={caseReference}
                onChange={(event) => setCaseReference(event.target.value)}
                placeholder="CASE-2026-001"
                autoComplete="off"
              />
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="file-owner">Dueño</FieldLabel>
              {file.owner ? (
                <span id="file-owner" data-file-owner>
                  <MemberIdentifier personId={file.owner.person_id} href={ownerHref} /> · desde{' '}
                  {formatInstant(file.owner.since)}
                </span>
              ) : (
                <span id="file-owner">Sin dueño: nadie ha reclamado el gimnasio.</span>
              )}
            </Field>
          </FieldGroup>

          <Alert live="off" variant="info" data-file-team-summary>
            <AlertTitle>Equipo</AlertTitle>
            <AlertDescription>{teamSentence(file)}</AlertDescription>
          </Alert>

          <Alert live="off" variant="info" data-file-people-served>
            <AlertTitle>Personas que atiende</AlertTitle>
            <AlertDescription>{peopleServedSentence(file)}</AlertDescription>
          </Alert>

          {file.team.length > 0 ? (
            <Table scrollAreaLabel="Equipo">
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {file.team.map((member) => (
                  <TableRow key={member.membership_id} data-file-member>
                    <TableCell>
                      <MemberIdentifier
                        personId={member.person_id}
                        href={memberCardHref(member.person_id, caseReference)}
                      />
                    </TableCell>
                    <TableCell>{rolesLabel(member.roles)}</TableCell>
                    <TableCell>{formatInstant(member.joined_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {/* A gym nobody claimed has no team and no clients yet, so neither kind of
          invitation exists for it. */}
      {handsOverHere(file) ? null : (
        <OrganizationTeamInvitations organizationId={organization.organization_id} />
      )}

      {handsOverHere(file) ? null : (
        <OrganizationClientInvitations organizationId={organization.organization_id} />
      )}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Sedes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {file.sites.length === 0 ? (
            <span data-file-no-sites>Sin sedes declaradas.</span>
          ) : (
            <Table scrollAreaLabel="Sedes">
              <TableHeader>
                <TableRow>
                  <TableHead>Sede</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {file.sites.map((site) => (
                  <TableRow
                    key={site.site_id}
                    data-file-site
                    data-address-withheld={site.address_withheld}
                  >
                    <TableCell>{site.name}</TableCell>
                    <TableCell>{siteAddress(site)}</TableCell>
                    <TableCell>
                      <Badge variant={site.status === 'active' ? 'success' : 'secondary'}>
                        {site.status === 'active' ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-file-plans>
        <CardHeader>
          <CardTitle role="heading" aria-level={3}>
            Planes y cobro
          </CardTitle>
          <CardDescription>
            Lo que el gimnasio le cobra a sus clientes, en su propia pasarela. El dinero no pasa por
            Allfit y aquí no hay ninguna credencial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {file.plans.length === 0 ? (
            <p data-file-no-plans>{NO_PLANS_NOTE}</p>
          ) : (
            <ul>
              {file.plans.map((plan) => (
                <li key={plan.plan_id} data-file-plan={plan.plan_id}>
                  <strong>{plan.name}</strong> · {planLine(plan)}
                </li>
              ))}
            </ul>
          )}
          <p data-file-payment-method>{paymentMethodLine(file)}</p>
          <p data-file-premium>{premiumLine(file)}</p>
        </CardContent>
      </Card>

      <Link href="/organizations" data-handover-link>
        Volver al directorio
      </Link>
    </div>
  )
}

function MemberIdentifier({ personId, href }: { personId: string; href: string | undefined }) {
  return href ? (
    <Link href={href} data-file-member-link>
      <code>{personId}</code>
    </Link>
  ) : (
    <code>{personId}</code>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return fileMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return fileMessage(error.code)
  return fileMessage('upstream-unavailable')
}
