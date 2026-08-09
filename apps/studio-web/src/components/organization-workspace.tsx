'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { organizationTypeLabel } from './membership-selector'
import { LoadingStage, StudioFrame } from './studio-frame'
import { membershipRoleSummary } from '@/lib/membership-roles'
import { StudioApiError, studioApi, type Membership } from '@/lib/studio-api'

type WorkspaceState =
  | { kind: 'loading' }
  | { kind: 'ready'; current: Membership; memberships: Membership[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export function OrganizationWorkspace({ organizationId }: { organizationId: string }) {
  const router = useRouter()
  const [state, setState] = useState<WorkspaceState>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const { items } = await studioApi.memberships()
      const active = items.filter((membership) => membership.status === 'active')
      const current = active.find((membership) => membership.organization_id === organizationId)
      setState(current ? { kind: 'ready', current, memberships: active } : { kind: 'forbidden' })
    } catch (caught) {
      if (caught instanceof StudioApiError && caught.status === 401) {
        router.replace('/')
        return
      }
      setState({ kind: 'error' })
    }
  }, [organizationId, router])

  useEffect(() => {
    void load()
  }, [load])

  if (state.kind === 'loading') return <LoadingStage label="Abriendo tu workspace…" />
  if (state.kind === 'forbidden') {
    return (
      <StudioFrame step="ready">
        <div data-studio-error-stage>
          <Alert variant="warning">
            <AlertTitle>Este espacio no está disponible</AlertTitle>
            <AlertDescription>
              No tienes una membresía activa para esta organización.
            </AlertDescription>
            <Button onClick={() => router.replace('/')}>Volver a mis espacios</Button>
          </Alert>
        </div>
      </StudioFrame>
    )
  }
  if (state.kind === 'error') {
    return (
      <StudioFrame step="ready">
        <div data-studio-error-stage>
          <Alert variant="danger" live="assertive">
            <AlertTitle>No pudimos cargar el espacio</AlertTitle>
            <AlertDescription>La conexión falló de forma temporal.</AlertDescription>
            <Button onClick={() => void load()}>Reintentar</Button>
          </Alert>
        </div>
      </StudioFrame>
    )
  }

  const { current, memberships } = state
  return (
    <StudioFrame step="ready">
      <article data-workspace>
        <header data-workspace-heading>
          <div>
            <p data-studio-eyebrow>{organizationTypeLabel(current.type_code)}</p>
            <h1>Tu espacio está listo.</h1>
            <p>{current.display_name}</p>
          </div>
          <div data-workspace-identity>
            <Badge variant="success">Organización activa</Badge>
            <Badge variant="sport">{membershipRoleSummary(current.roles)}</Badge>
          </div>
        </header>

        {memberships.length > 1 ? (
          <label data-workspace-switcher>
            <span>Cambiar de organización</span>
            <select
              data-studio-native-control
              value={current.organization_id}
              onChange={(event) => router.push(`/organizations/${event.target.value}`)}
            >
              {memberships.map((membership) => (
                <option key={membership.membership_id} value={membership.organization_id}>
                  {membership.display_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <section data-workspace-status aria-labelledby="workspace-status-title">
          <div>
            <span>01</span>
            <p>Identidad</p>
            <strong>Completada</strong>
          </div>
          <div>
            <span>02</span>
            <p>Espacio</p>
            <strong>Completado</strong>
          </div>
          <div data-current>
            <span>03</span>
            <p id="workspace-status-title">Workspace</p>
            <strong>Activo</strong>
          </div>
        </section>

        <section data-next-steps>
          <div data-studio-panel-intro>
            <p data-studio-eyebrow>Lo que viene</p>
            <h2>La base está preparada.</h2>
            <p>Estos módulos se habilitarán en los siguientes cortes del producto.</p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Completar perfil profesional</strong>
                <p>Especialidades, presentación y señales profesionales.</p>
              </div>
              <small>Próximamente</small>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Invitar al equipo</strong>
                <p>Membresías, roles y aceptación de invitaciones.</p>
              </div>
              <small>Próximamente</small>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Configurar la operación</strong>
                <p>Disciplinas, sedes y preferencias del espacio.</p>
              </div>
              <small>Próximamente</small>
            </li>
          </ol>
        </section>
      </article>
    </StudioFrame>
  )
}
