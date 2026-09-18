import { Badge } from '@allfitone/react/components/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
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
import { WorkspaceEyebrow, WorkspaceTitle } from '@allfitone/react/components/workspace-shell'
import { FoundationIcon } from '@allfitone/react/icons'

import { organizationTypeLabel } from './membership-selector'
import { membershipRoleLabels, membershipRoleSummary } from '@/lib/membership-roles'
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
      <header data-profile-section-heading>
        <div data-profile-section-heading-text>
          <WorkspaceEyebrow data-profile-kicker>Actividad en Studio</WorkspaceEyebrow>
          <WorkspaceTitle as="h2" id="memberships-title">
            Mis espacios
          </WorkspaceTitle>
          <p data-page-header-description>
            Consulta tus vinculaciones. Esta vista no cambia roles ni permisos.
          </p>
        </div>
      </header>
      {/* Always two figures, so the strip always shares the row. */}
      <div data-profile-signals data-signals-multiple>
        <StatStrip>
          <StatStripItem value={active.length} label="Espacios activos" />
          <StatStripItem value={terminated.length} label="Vinculaciones finalizadas" />
        </StatStrip>
      </div>
      {active.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FoundationIcon name="organization" decorative />
            </EmptyMedia>
            <EmptyTitle>Aún no tienes espacios</EmptyTitle>
            <EmptyDescription>
              Puedes crear una organización o aceptar una invitación cuando lo necesites.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div data-membership-context-grid>
          {active.map((membership) => (
            <Card key={membership.membership_id}>
              <CardHeader>
                <CardDescription data-profile-kicker>
                  {organizationTypeLabel(membership.type_code)}
                </CardDescription>
                <CardTitle role="heading" aria-level={3}>
                  {membership.display_name}
                </CardTitle>
              </CardHeader>
              <CardContent data-membership-card-body>
                {/* One badge per role, in the body rather than the header
                    action. Joined into a single badge that cannot wrap,
                    "Propietario · Administrador" ran 7px past the viewport at
                    320px: the header sizes its action column to its content. */}
                <div data-membership-roles>
                  {membershipRoleLabels(membership.roles).map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                </div>
                <p>Vinculación activa desde {formatDate(membership.joined_at)}.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {terminated.length > 0 ? (
        <Collapsible data-membership-history>
          <CollapsibleTrigger render={<Button variant="ghost" />} data-history-trigger>
            Historial de vinculaciones · {terminated.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div data-membership-context-grid>
              {terminated.map((membership) => (
                <Card key={membership.membership_id} data-membership-terminated>
                  <CardHeader>
                    <CardDescription data-profile-kicker>
                      {organizationTypeLabel(membership.type_code)}
                    </CardDescription>
                    <CardTitle role="heading" aria-level={3}>
                      {membership.display_name}
                    </CardTitle>
                    <CardAction>
                      <Badge variant="outline">Finalizada</Badge>
                    </CardAction>
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
