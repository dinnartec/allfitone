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
import { canInviteTeam } from '@/lib/team-invitations'

export function TeamSectionNavigation() {
  const pathname = usePathname()
  const { current } = useOrganizationContext()
  const basePath = `/organizations/${current.organization_id}/team`
  // Integrantes is listed for every role. Hiding it made the same sidebar label
  // resolve to different pages per person; the directory itself explains the
  // denial in place, and authorization still fails closed on the server.
  const destinations = [
    { href: basePath, label: 'Integrantes', active: pathname === basePath },
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
      // One word, like its two siblings. "Roles y permisos" wrapped to two lines
      // on a phone; the page still titles itself in full.
      label: 'Roles',
      active: pathname === `${basePath}/roles`,
    },
  ]

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
