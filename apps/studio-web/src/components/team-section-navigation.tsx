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

export function TeamSectionNavigation() {
  const pathname = usePathname()
  const { current } = useOrganizationContext()
  const basePath = `/organizations/${current.organization_id}/team`
  // Every section is listed for every role. Hiding one made the same sidebar
  // label resolve to different pages per person, and left a coach who opened
  // an invitation URL on a page with no tab selected. Each section explains its
  // own denial, and authorization still fails closed on the server.
  const destinations = [
    { href: basePath, label: 'Integrantes', active: pathname === basePath },
    {
      href: `${basePath}/invitations`,
      label: 'Invitaciones',
      active: pathname.startsWith(`${basePath}/invitations`),
    },
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
