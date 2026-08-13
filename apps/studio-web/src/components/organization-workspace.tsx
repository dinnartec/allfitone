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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@allfitone/react/components/empty'
import { Skeleton } from '@allfitone/react/components/skeleton'
import { StatStrip, StatStripItem } from '@allfitone/react/components/stat-strip'
import { FoundationIcon } from '@allfitone/react/icons'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useOrganizationContext } from './organization-context'
import {
  countPage,
  formatTotal,
  invitationsExpiringWithin,
  recentMembers,
  type CountedTotal,
} from '@/lib/organization-overview'
import { canViewTeamDirectory, memberInitials, organizationRoleLabel } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'
import {
  studioApi,
  type Membership,
  type OrganizationMembership,
  type TeamInvitationListItem,
} from '@/lib/studio-api'

const INVITATIONS_ENABLED = process.env.NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED === 'true'
const OVERVIEW_PAGE_SIZE = 50
const RECENT_MEMBER_LIMIT = 5
const EXPIRY_WINDOW_DAYS = 7
const DATE_FORMATTER = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })

interface Overview {
  members: { total: CountedTotal; recent: OrganizationMembership[] } | null
  invitations: { total: CountedTotal; attention: TeamInvitationListItem[] } | null
}

type Status = 'loading' | 'ready' | 'error'

export function OrganizationWorkspace() {
  const { current } = useOrganizationContext()
  const canSeeDirectory = canViewTeamDirectory(current.roles)
  const canSeeInvitations = INVITATIONS_ENABLED && canInviteTeam(current.roles)
  const readsSomething = canSeeDirectory || canSeeInvitations
  const teamPath = `/organizations/${current.organization_id}/team`

  const [overview, setOverview] = useState<Overview>({ members: null, invitations: null })
  const [status, setStatus] = useState<Status>(readsSomething ? 'loading' : 'ready')
  const requestId = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!readsSomething) return
    requestController.current?.abort()
    const controller = new AbortController()
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    requestController.current = controller
    setStatus('loading')

    // Each source degrades on its own. One unavailable endpoint must not blank
    // out the reading that did arrive; only losing everything is an error.
    const [members, invitations] = await Promise.allSettled([
      canSeeDirectory
        ? studioApi.organizationMemberships(
            current.organization_id,
            { status: 'active', limit: OVERVIEW_PAGE_SIZE },
            controller.signal,
          )
        : Promise.resolve(null),
      canSeeInvitations
        ? studioApi.teamInvitations(
            current.organization_id,
            { status: 'pending', limit: OVERVIEW_PAGE_SIZE },
            controller.signal,
          )
        : Promise.resolve(null),
    ])
    if (controller.signal.aborted || currentRequest !== requestId.current) return

    const memberPage = members.status === 'fulfilled' ? members.value : null
    const invitationPage = invitations.status === 'fulfilled' ? invitations.value : null

    setOverview({
      members: memberPage
        ? {
            total: countPage(memberPage),
            recent: recentMembers(memberPage.data, RECENT_MEMBER_LIMIT),
          }
        : null,
      invitations: invitationPage
        ? {
            total: countPage(invitationPage),
            attention: invitationsExpiringWithin(
              invitationPage.data,
              EXPIRY_WINDOW_DAYS,
              new Date(),
            ),
          }
        : null,
    })
    setStatus(memberPage || invitationPage ? 'ready' : 'error')
  }, [canSeeDirectory, canSeeInvitations, current.organization_id, readsSomething])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
      requestController.current?.abort()
    }
  }, [load])

  if (!readsSomething) {
    return <OrientationPanel roles={current.roles} teamPath={teamPath} />
  }

  return (
    <div data-organization-overview>
      <section data-overview-signals aria-label={`Estado de ${current.display_name}`}>
        {status === 'loading' ? (
          <Skeleton data-overview-signals-placeholder />
        ) : status === 'error' ? (
          <Alert variant="danger" live="polite">
            <AlertTitle>No pudimos cargar el estado de tu organización</AlertTitle>
            <AlertDescription>
              La conexión falló de forma temporal. Los datos siguen intactos.
            </AlertDescription>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Reintentar
            </Button>
          </Alert>
        ) : (
          <StatStrip>
            {overview.members ? (
              <StatStripItem
                value={formatTotal(overview.members.total)}
                label="Integrantes activos"
              />
            ) : null}
            {overview.invitations ? (
              <StatStripItem
                value={formatTotal(overview.invitations.total)}
                label="Invitaciones pendientes"
              />
            ) : null}
          </StatStrip>
        )}
      </section>

      {status === 'ready' && overview.invitations && overview.invitations.attention.length > 0 ? (
        <Card data-overview-attention>
          <CardHeader>
            <CardTitle>
              <h2>Requiere atención</h2>
            </CardTitle>
            <CardDescription>
              {overview.invitations.attention.length === 1
                ? 'Una invitación vence en los próximos días.'
                : `${overview.invitations.attention.length} invitaciones vencen en los próximos días.`}
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
              {overview.invitations.attention.map((invitation) => (
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

      {overview.members || status === 'loading' ? (
        <Card data-overview-team>
          <CardHeader>
            <CardTitle>
              <h2>Equipo reciente</h2>
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
            {status === 'loading' ? (
              <div data-overview-team-placeholder>
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : overview.members && overview.members.recent.length > 0 ? (
              <ul data-overview-team-list>
                {overview.members.recent.map((member) => (
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
                <EmptyMedia variant="icon">
                  <FoundationIcon name="people" decorative />
                </EmptyMedia>
                <EmptyTitle>Trabajas en solitario por ahora</EmptyTitle>
                <EmptyDescription>
                  Cuando alguien acepte una invitación aparecerá aquí.
                </EmptyDescription>
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
          <CardTitle>
            <h2>Tu participación en esta organización</h2>
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
