'use client'

import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardContent,
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
import { membershipRoleLabels } from '@/lib/membership-roles'
import type { Membership } from '@/lib/studio-api'

export function MembershipSelector({
  memberships,
  onSelect,
}: {
  memberships: Membership[]
  onSelect: (organizationId: string) => void
}) {
  // No step. This screen only appears for someone with more than one active
  // membership, so they finished setup long ago: the bar told a returning
  // person they were on step 3 of 3 of something they do every sign-in.
  return (
    <StudioFrame>
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
              </CardHeader>
              {/* One badge per role in the body, not a joined string in the
                  header action. "Propietario · Administrador" in a single
                  non-wrapping badge ran 36px past the viewport at 320px — the
                  same fault the account cards had, worse here because this card
                  sits in a two-column panel. */}
              <CardContent data-membership-card-body>
                <div data-membership-roles>
                  {membershipRoleLabels(membership.roles).map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
              <CardFooter>
                <div data-card-footer-actions>
                  <Button onClick={() => onSelect(membership.organization_id)}>
                    Entrar al espacio
                  </Button>
                </div>
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
