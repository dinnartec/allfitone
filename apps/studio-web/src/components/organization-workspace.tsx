'use client'

import { Badge } from '@allfitone/react/components/badge'
import { buttonVariants } from '@allfitone/react/components/button'
import { FoundationIcon } from '@allfitone/react/icons'
import Link from 'next/link'

import { useOrganizationContext } from './organization-context'
import { canViewTeamDirectory } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'

const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'

export function OrganizationWorkspace() {
  const { current } = useOrganizationContext()
  const canViewDirectory = canViewTeamDirectory(current.roles)
  const canManageInvitations = canInviteTeam(current.roles)
  const canInvite = INVITATIONS_ENABLED && canManageInvitations
  const teamPath = `/organizations/${current.organization_id}/team`

  return (
    <div data-organization-home>
      <section data-operational-ready aria-labelledby="operational-ready-title">
        <div data-operational-ready-copy>
          <p data-studio-eyebrow>Disponible ahora</p>
          <h2 id="operational-ready-title">Studio está listo para operar</h2>
          <p>
            Tu identidad y la organización están activas. Ya puedes recorrer el workspace sin
            completar configuraciones adicionales.
          </p>
        </div>
        <div data-operational-ready-signal>
          <FoundationIcon name="success" decorative />
          <div>
            <span>Contexto activo</span>
            <strong>{current.display_name}</strong>
          </div>
          <Badge variant="success">Listo</Badge>
        </div>
      </section>

      <section data-configure-later aria-labelledby="configure-later-title">
        <header>
          <p data-studio-eyebrow>A tu ritmo</p>
          <h2 id="configure-later-title">Configura a tu ritmo</h2>
          <p>
            Tu espacio ya funciona. Estos pasos no bloquean el acceso y puedes hacerlos después.
          </p>
        </header>

        <div data-configure-later-list>
          {canViewDirectory ? (
            <article data-configure-later-item>
              <span data-configure-item-icon>
                <FoundationIcon name="people" decorative />
              </span>
              <div>
                <div data-configure-item-title>
                  <h3>Sumar al equipo</h3>
                  <Badge variant="outline">Opcional</Badge>
                </div>
                <p>
                  Consulta las membresías actuales e invita únicamente cuando vayas a sumar equipo.
                </p>
              </div>
              <div data-configure-item-actions>
                <Link
                  href={teamPath}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Ver equipo
                </Link>
                {canInvite ? (
                  <Link
                    href={`${teamPath}/invitations/new`}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    Invitar integrante
                  </Link>
                ) : null}
              </div>
            </article>
          ) : (
            <article data-configure-later-item>
              <span data-configure-item-icon>
                <FoundationIcon name="permissions" decorative />
              </span>
              <div>
                <div data-configure-item-title>
                  <h3>Conocer roles y permisos</h3>
                  <Badge variant="outline">Disponible</Badge>
                </div>
                <p>Consulta qué permite cada rol y cómo se protege el acceso a datos fitness.</p>
              </div>
              <div data-configure-item-actions>
                <Link
                  href={`${teamPath}/roles`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Ver roles
                </Link>
              </div>
            </article>
          )}

          <article data-configure-later-item data-coming-soon>
            <span data-configure-item-icon>
              <FoundationIcon name="operation" decorative />
            </span>
            <div>
              <div data-configure-item-title>
                <h3>Configurar la operación</h3>
                <Badge variant="outline">Opcional</Badge>
                <Badge variant="secondary">Próximamente</Badge>
              </div>
              <p>Disciplinas, sedes y preferencias estarán disponibles en un próximo corte.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}
