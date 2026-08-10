import { Badge } from '@allfitone/react/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@allfitone/react/components/card'
import { Button } from '@allfitone/react/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@allfitone/react/components/collapsible'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import { StatStrip, StatStripItem } from '@allfitone/react/components/stat-strip'

import { organizationTypeLabel } from './membership-selector'
import { membershipRoleSummary } from '@/lib/membership-roles'
import type { Membership } from '@/lib/studio-api'

export function ProfessionalMemberships({ memberships }: { memberships: Membership[] }) {
  const active = memberships
    .filter((membership) => membership.status === 'active')
    .toSorted((left, right) => left.display_name.localeCompare(right.display_name, 'es'))
  const terminated = memberships
    .filter((membership) => membership.status === 'terminated')
    .toSorted((left, right) => {
      const byEndDate = (right.ended_at ?? '').localeCompare(left.ended_at ?? '')
      return byEndDate || left.display_name.localeCompare(right.display_name, 'es')
    })
  return (
    <section data-profile-section aria-labelledby="memberships-title">
      <div data-profile-section-heading>
        <div>
          <p data-profile-kicker>Contexto profesional</p>
          <h2 id="memberships-title">Dónde trabajas</h2>
          <p>Estas membresías son informativas y no se pueden editar desde tu perfil.</p>
        </div>
      </div>
      <StatStrip>
        <StatStripItem value={active.length} label="Espacios activos" />
        <StatStripItem value={terminated.length} label="Vinculaciones finalizadas" />
      </StatStrip>
      {active.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">00</EmptyMedia>
            <EmptyTitle>Tu perfil es independiente de un espacio</EmptyTitle>
            <EmptyDescription>
              Puedes completar tu presentación ahora y crear una organización después.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div data-membership-context-grid>
          {active.map((membership) => (
            <Card key={membership.membership_id}>
              <CardHeader>
                <div>
                  <p data-profile-kicker>{organizationTypeLabel(membership.type_code)}</p>
                  <CardTitle>{membership.display_name}</CardTitle>
                </div>
                <Badge variant="outline">{membershipRoleSummary(membership.roles)}</Badge>
              </CardHeader>
              <CardContent>
                <p>Vinculación activa desde {formatDate(membership.joined_at)}.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {terminated.length > 0 ? (
        <Collapsible data-membership-history>
          <CollapsibleTrigger render={<Button variant="ghost" />}>
            Historial de vinculaciones · {terminated.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div data-membership-context-grid>
              {terminated.map((membership) => (
                <Card key={membership.membership_id} data-membership-terminated>
                  <CardHeader>
                    <div>
                      <p data-profile-kicker>{organizationTypeLabel(membership.type_code)}</p>
                      <CardTitle>{membership.display_name}</CardTitle>
                    </div>
                    <Badge variant="outline">Finalizada</Badge>
                  </CardHeader>
                  <CardContent>
                    <p>
                      {membershipRoleSummary(membership.roles)} · {formatDate(membership.joined_at)}
                      {' — '}
                      {membership.ended_at
                        ? formatDate(membership.ended_at)
                        : 'Sin fecha registrada'}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
}
