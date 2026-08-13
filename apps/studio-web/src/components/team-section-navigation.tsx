'use client'

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@allfitone/react/components/navigation-menu'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useOrganizationContext } from './organization-context'
import { canViewTeamDirectory } from '@/lib/team-directory'
import { canInviteTeam } from '@/lib/team-invitations'

export function TeamSectionNavigation() {
  const pathname = usePathname()
  const { current } = useOrganizationContext()
  const basePath = `/organizations/${current.organization_id}/team`
  const destinations = [
    ...(canViewTeamDirectory(current.roles)
      ? [{ href: basePath, label: 'Integrantes', active: pathname === basePath }]
      : []),
    ...(canInviteTeam(current.roles)
      ? [
          {
            href: `${basePath}/invitations`,
            label: 'Invitaciones',
            active: pathname.startsWith(`${basePath}/invitations`),
          },
        ]
      : []),
    {
      href: `${basePath}/roles`,
      label: 'Roles y permisos',
      active: pathname === `${basePath}/roles`,
    },
  ]

  if (destinations.length <= 1) return null

  return (
    <nav data-team-section-navigation aria-label="Secciones del equipo">
      <NavigationMenu>
        <NavigationMenuList>
          {destinations.map((destination) => (
            <NavigationMenuItem key={destination.href}>
              <NavigationMenuLink
                active={destination.active}
                aria-current={destination.active ? 'page' : undefined}
                render={<Link href={destination.href} />}
              >
                {destination.label}
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
    </nav>
  )
}
