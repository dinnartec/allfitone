'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@allfitone/react/components/collapsible'
import { Spinner } from '@allfitone/react/components/spinner'
import { FoundationIcon } from '@allfitone/react/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useOrganizationContext } from './organization-context'
import { WorkspacePageHeader } from './workspace-page-header'
import type { OrganizationRole } from '@/lib/studio-api'
import { isStudioForbidden, organizationRolesQueryOptions } from '@/lib/studio-query'

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; roles: OrganizationRole[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

const EXPECTED_ROLE_CODES = ['owner', 'admin', 'coach', 'staff'] as const

export function OrganizationRoleCatalog() {
  const { current } = useOrganizationContext()
  const query = useQuery(organizationRolesQueryOptions(current.organization_id))
  const forbidden = isStudioForbidden(query.error)
  const roles =
    !forbidden && query.data?.items && hasExpectedRoles(query.data.items)
      ? query.data.items
      : undefined
  const state: CatalogState = forbidden
    ? { kind: 'forbidden' }
    : roles
      ? { kind: 'ready', roles }
      : query.isPending
        ? { kind: 'loading' }
        : { kind: 'error' }

  return (
    <section data-team-page data-role-page aria-label="Roles y permisos">
      <WorkspacePageHeader
        description={`Consulta para qué sirve cada rol antes de decidir cómo debe participar una persona en ${current.display_name}.`}
      />

      <Alert variant="info">
        <AlertTitle>Cuatro roles fijos, solo consulta</AlertTitle>
        <AlertDescription>Desde esta pantalla no se cambian roles.</AlertDescription>
      </Alert>

      {query.isFetching && state.kind === 'ready' ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando roles y permisos…
        </p>
      ) : null}

      {query.isError && state.kind === 'ready' ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No pudimos actualizar los roles</AlertTitle>
          <AlertDescription>El catálogo cargado permanece visible.</AlertDescription>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : null}

      {state.kind === 'loading' ? (
        <Card>
          <CardContent data-role-catalog-state>
            <Spinner label="Cargando roles y permisos" />
            <p>Cargando roles y permisos…</p>
          </CardContent>
        </Card>
      ) : null}

      {state.kind === 'forbidden' ? (
        <Alert variant="warning">
          <AlertTitle>No puedes consultar estos roles</AlertTitle>
          <AlertDescription>
            La organización o tu membresía ya no están disponibles.
          </AlertDescription>
        </Alert>
      ) : null}

      {state.kind === 'error' ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No pudimos cargar los roles</AlertTitle>
          <AlertDescription>
            La conexión falló de forma temporal. El catálogo permanecerá oculto hasta comprobarlo de
            nuevo.
          </AlertDescription>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : null}

      {state.kind === 'ready' ? (
        <div data-role-register>
          {state.roles.map((role) => (
            <RoleRegisterItem key={role.code} role={role} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function RoleRegisterItem({ role }: { role: OrganizationRole }) {
  const [open, setOpen] = useState(false)
  const policy = fitnessPolicy(role)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-role-card={role.code}>
      <Card data-role-register-item>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {role.name}
          </CardTitle>
          <CardDescription>{rolePurpose(role.code)}</CardDescription>
          <CardAction>
            <Badge variant="code">{role.code}</Badge>
          </CardAction>
        </CardHeader>

        <CardContent data-role-card-body>
          <Alert
            variant={role.fitness_data_access_policy === 'not_granted_by_role' ? 'success' : 'info'}
          >
            <AlertTitle>{policy.summary}</AlertTitle>
            <AlertDescription>{policy.detail}</AlertDescription>
          </Alert>

          <div data-role-disclosure>
            <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
              {open ? 'Ocultar capacidades' : 'Ver capacidades'}
              <FoundationIcon name={open ? 'collapse' : 'expand'} decorative />
            </CollapsibleTrigger>
            <Badge variant="outline">{role.capabilities.length} capacidades</Badge>
          </div>

          <CollapsibleContent>
            <ul data-role-capability-list>
              {role.capabilities.map((capability) => (
                <li key={capability.code}>
                  <FoundationIcon name="check" size="sm" decorative />
                  <span>{capability.name}</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  )
}

function rolePurpose(code: OrganizationRole['code']): string {
  if (code === 'owner') return 'Control total, propiedad y decisiones críticas de la organización.'
  if (code === 'admin') return 'Operación, equipo, relaciones y cobros sin transferir propiedad.'
  if (code === 'coach') {
    return 'Planificación y acompañamiento sujetos a relación, asignación y grants.'
  }
  return 'Invitaciones y consulta del directorio sin acceso a datos fitness.'
}

function fitnessPolicy(role: OrganizationRole): { summary: string; detail: string } {
  if (role.code === 'coach') {
    return {
      summary: 'Acceso fitness condicionado',
      detail:
        'El rol por sí solo no basta: requiere relación, asignación, grant y condiciones profesionales vigentes.',
    }
  }
  return {
    summary: 'Sin acceso fitness por rol',
    detail: 'El rol no concede acceso a datos fitness.',
  }
}

function hasExpectedRoles(roles: OrganizationRole[]): boolean {
  return (
    roles.length === EXPECTED_ROLE_CODES.length &&
    roles.every((role, index) => role.code === EXPECTED_ROLE_CODES[index])
  )
}
