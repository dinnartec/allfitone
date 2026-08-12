'use client'

import { Button } from '@allfitone/react/components/button'
import { useRouter } from 'next/navigation'

import { useOrganizationContext } from './organization-context'
import { canInviteTeam } from '@/lib/team-invitations'

const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'

export function OrganizationWorkspace() {
  const router = useRouter()
  const { current } = useOrganizationContext()
  const canManageInvitations = canInviteTeam(current.roles)
  const canInvite = INVITATIONS_ENABLED && canManageInvitations
  return (
    <>
      <section data-workspace-welcome>
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Workspace</p>
          <h2>Tu espacio está listo.</h2>
          <p>
            El contexto activo se aplicará a todos los módulos que abras desde esta organización.
          </p>
        </div>
      </section>

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
          <p id="workspace-status-title">Listo</p>
          <strong>Workspace activo</strong>
        </div>
      </section>

      <section data-next-steps>
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Siguientes pasos</p>
          <h2>La base está preparada.</h2>
          <p>Estos módulos se habilitarán en los siguientes cortes del producto.</p>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Invitar al equipo</strong>
              <p>Membresías, roles y aceptación de invitaciones.</p>
            </div>
            {canManageInvitations ? (
              <div data-workspace-actions>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    router.push(`/organizations/${current.organization_id}/team/invitations`)
                  }
                >
                  Gestionar
                </Button>
                {canInvite ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      router.push(`/organizations/${current.organization_id}/team/invitations/new`)
                    }
                  >
                    Invitar
                  </Button>
                ) : null}
              </div>
            ) : (
              <small>Próximamente</small>
            )}
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Configurar la operación</strong>
              <p>Disciplinas, sedes y preferencias del espacio.</p>
            </div>
            <small>Próximamente</small>
          </li>
        </ol>
      </section>
    </>
  )
}
