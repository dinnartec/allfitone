'use client'

import { Button } from '@allfitone/react/components/button'

import { StudioFrame } from './studio-frame'
import { membershipRoleSummary } from '@/lib/membership-roles'
import type { Membership } from '@/lib/studio-api'

export function MembershipSelector({
  memberships,
  onSelect,
}: {
  memberships: Membership[]
  onSelect: (organizationId: string) => void
}) {
  return (
    <StudioFrame step="ready">
      <article data-studio-panel="selector">
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Selecciona un espacio</p>
          <h1>¿Dónde quieres trabajar hoy?</h1>
          <p>Tu identidad tiene acceso activo a más de una organización.</p>
        </div>
        <div data-membership-list>
          {memberships.map((membership) => (
            <section key={membership.membership_id} data-membership-card>
              <div>
                <span data-membership-type>{organizationTypeLabel(membership.type_code)}</span>
                <h2>{membership.display_name}</h2>
                <p>{membershipRoleSummary(membership.roles)}</p>
              </div>
              <Button onClick={() => onSelect(membership.organization_id)}>
                Entrar al espacio
              </Button>
            </section>
          ))}
        </div>
      </article>
    </StudioFrame>
  )
}

export function organizationTypeLabel(type: Membership['type_code']): string {
  return {
    professional_practice: 'Práctica profesional',
    gym: 'Gimnasio',
    studio: 'Estudio',
    academy: 'Academia',
    clinic: 'Clínica',
  }[type]
}
