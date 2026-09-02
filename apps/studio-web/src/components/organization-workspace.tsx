'use client'

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Avatar, AvatarFallback } from '@allfitone/react/components/avatar'
import { Badge } from '@allfitone/react/components/badge'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import { Skeleton } from '@allfitone/react/components/skeleton'
import { StatStrip, StatStripItem } from '@allfitone/react/components/stat-strip'
import { FoundationIcon } from '@allfitone/react/icons'
import { useInfiniteQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { useOrganizationContext } from './organization-context'
import {
  countPage,
  formatTotal,
  invitationsExpiringWithin,
  recentMembers,
} from '@/lib/organization-overview'
import { canViewTeamDirectory, memberInitials, organizationRoleLabel } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'
import type { Membership } from '@/lib/studio-api'
import {
  isStudioForbidden,
  organizationInvitationsQueryOptions,
  organizationMembershipsQueryOptions,
} from '@/lib/studio-query'

const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'
const OVERVIEW_PAGE_SIZE = 50
const RECENT_MEMBER_LIMIT = 5
const EXPIRY_WINDOW_DAYS = 7
const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

export function OrganizationWorkspace() {
  const { current } = useOrganizationContext()
  const canSeeDirectory = canViewTeamDirectory(current.roles)
  const canSeeInvitations = INVITATIONS_ENABLED && canInviteTeam(current.roles)
  const readsSomething = canSeeDirectory || canSeeInvitations
  const teamPath = `/organizations/${current.organization_id}/team`

  const membersQuery = useInfiniteQuery({
    ...organizationMembershipsQueryOptions(current.organization_id, 'active', OVERVIEW_PAGE_SIZE),
    enabled: canSeeDirectory,
  })
  const invitationsQuery = useInfiniteQuery({
    ...organizationInvitationsQueryOptions(current.organization_id, 'pending', OVERVIEW_PAGE_SIZE),
    enabled: canSeeInvitations,
  })
  const membersForbidden = isStudioForbidden(membersQuery.error)
  const invitationsForbidden = isStudioForbidden(invitationsQuery.error)
  const memberPage = canSeeDirectory && !membersForbidden ? membersQuery.data?.pages[0] : undefined
  const invitationPage =
    canSeeInvitations && !invitationsForbidden ? invitationsQuery.data?.pages[0] : undefined
  const loading =
    (canSeeDirectory && membersQuery.isPending) || (canSeeInvitations && invitationsQuery.isPending)
  const error = !loading && !memberPage && !invitationPage
  const refreshing =
    Boolean(memberPage || invitationPage) &&
    (membersQuery.isFetching || invitationsQuery.isFetching)
  const members = memberPage
    ? {
        total: countPage(memberPage),
        recent: recentMembers(memberPage.data, RECENT_MEMBER_LIMIT),
      }
    : null
  const invitations = invitationPage
    ? {
        total: countPage(invitationPage),
        attention: invitationsExpiringWithin(invitationPage.data, EXPIRY_WINDOW_DAYS, new Date()),
      }
    : null

  function retry(): void {
    if (canSeeDirectory) void membersQuery.refetch()
    if (canSeeInvitations) void invitationsQuery.refetch()
  }

  if (!readsSomething) {
    return <OrientationPanel roles={current.roles} teamPath={teamPath} />
  }

  return (
    <div data-organization-overview>
      <section data-overview-signals aria-label={`Estado de ${current.display_name}`}>
        {loading ? (
          <Skeleton data-overview-signals-placeholder />
        ) : error ? (
          <Alert variant="danger" live="polite">
            <AlertTitle>No pudimos cargar el estado de tu organización</AlertTitle>
            <AlertDescription>
              La conexión falló de forma temporal. Los datos siguen intactos.
            </AlertDescription>
            <Button size="sm" variant="outline" onClick={retry}>
              Reintentar
            </Button>
          </Alert>
        ) : (
          <StatStrip>
            {members ? (
              <StatStripItem value={formatTotal(members.total)} label="Integrantes activos" />
            ) : null}
            {invitations ? (
              <StatStripItem
                value={formatTotal(invitations.total)}
                label="Invitaciones pendientes"
              />
            ) : null}
          </StatStrip>
        )}
      </section>

      {refreshing ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando el estado de la organización…
        </p>
      ) : null}

      {!loading && invitations && invitations.attention.length > 0 ? (
        <Card data-overview-attention>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Requiere atención
            </CardTitle>
            <CardDescription>
              {invitations.attention.length === 1
                ? 'Una invitación vence en los próximos días.'
                : `${invitations.attention.length} invitaciones vencen en los próximos días.`}
            </CardDescription>
            <CardAction>
              <Link
                href={`${teamPath}/invitations`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Ver invitaciones
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul data-overview-attention-list>
              {invitations.attention.map((invitation) => (
                <li key={invitation.id}>
                  <span data-overview-attention-contact>{invitation.contact}</span>
                  <span data-overview-attention-expiry>
                    Vence el {formatDate(invitation.expires_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {members || loading ? (
        <Card data-overview-team>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Equipo reciente
            </CardTitle>
            <CardDescription>
              Las últimas personas que se sumaron a la organización.
            </CardDescription>
            <CardAction>
              <Link href={teamPath} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Ver equipo
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div data-overview-team-placeholder>
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : members && members.recent.length > 0 ? (
              <ul data-overview-team-list>
                {members.recent.map((member) => (
                  <li key={member.membership_id}>
                    <Avatar decorative>
                      <AvatarFallback>{memberInitials(member.display_name)}</AvatarFallback>
                    </Avatar>
                    <div data-overview-team-identity>
                      <strong>{member.display_name}</strong>
                      <span>Desde el {formatDate(member.joined_at)}</span>
                    </div>
                    <div data-overview-team-roles>
                      {member.roles.map((role) => (
                        <Badge key={role} variant="secondary">
                          {organizationRoleLabel(role)}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FoundationIcon name="people" decorative />
                  </EmptyMedia>
                  <EmptyTitle>Trabajas en solitario por ahora</EmptyTitle>
                  <EmptyDescription>
                    Cuando alguien acepte una invitación aparecerá aquí.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// A coach reads neither the directory nor the invitation register, so the
// overview has nothing to count. Orientation is the honest content for them.
function OrientationPanel({ roles, teamPath }: { roles: Membership['roles']; teamPath: string }) {
  return (
    <div data-organization-overview>
      <Card data-overview-orientation>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Tu participación en esta organización
          </CardTitle>
          <CardDescription>
            Tu rol define qué puedes hacer aquí. El acceso a datos fitness siempre exige además
            relación, asignación y consentimiento vigentes.
          </CardDescription>
          <CardAction>
            <Link
              href={`${teamPath}/roles`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ver roles y permisos
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div data-overview-orientation-roles>
            {roles.map((role) => (
              <Badge key={role} variant="secondary">
                {organizationRoleLabel(role)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}
