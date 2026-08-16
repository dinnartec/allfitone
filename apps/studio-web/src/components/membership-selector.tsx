'use client'

import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  SetupPanel,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'

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
      <SetupPanel>
        <SetupPanelIntro>
          <SetupPanelEyebrow>Selecciona un espacio</SetupPanelEyebrow>
          <SetupPanelTitle>¿Dónde quieres trabajar hoy?</SetupPanelTitle>
          <SetupPanelDescription>
            Tu identidad tiene acceso activo a más de una organización.
          </SetupPanelDescription>
        </SetupPanelIntro>
        <SetupPanelContent data-membership-list>
          {memberships.map((membership) => (
            <Card key={membership.membership_id} data-membership-card>
              <CardHeader>
                <CardDescription>{organizationTypeLabel(membership.type_code)}</CardDescription>
                <CardTitle role="heading" aria-level={2}>
                  {membership.display_name}
                </CardTitle>
                <CardAction>
                  <Badge variant="secondary">{membershipRoleSummary(membership.roles)}</Badge>
                </CardAction>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => onSelect(membership.organization_id)}>
                  Entrar al espacio
                </Button>
              </CardFooter>
            </Card>
          ))}
        </SetupPanelContent>
      </SetupPanel>
    </StudioFrame>
  )
}

export function organizationTypeLabel(type: Membership['type_code']): string {
  return {
    professional_practice: 'Profesional independiente',
    gym: 'Gimnasio',
    studio: 'Estudio',
  }[type]
}
