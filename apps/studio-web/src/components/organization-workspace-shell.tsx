'use client'

import { ProductLockup } from '@allfitone/react/brand'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@allfitone/react/components/sidebar'
import {
  WorkspaceContent,
  WorkspaceHeader,
  WorkspaceHeading,
  WorkspaceMain,
  WorkspaceShell,
  WorkspaceTitle,
} from '@allfitone/react/components/workspace-shell'
import { FoundationIcon } from '@allfitone/react/icons'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { LogoutForm } from './logout-form'
import { organizationTypeLabel } from './membership-selector'
import { useOrganizationContext } from './organization-context'
import { canViewTeamDirectory } from '@/lib/team-directory'
import { membershipRoleSummary } from '@/lib/membership-roles'
import { resolveWorkspaceRoute } from '@/lib/organization-navigation'

export function OrganizationWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { current } = useOrganizationContext()
  const basePath = `/organizations/${current.organization_id}`
  const teamHref = canViewTeamDirectory(current.roles)
    ? `${basePath}/team`
    : `${basePath}/team/roles`
  const route = resolveWorkspaceRoute(pathname, current.organization_id)

  return (
    <WorkspaceShell data-organization-shell>
      <OrganizationSidebar basePath={basePath} teamHref={teamHref} pathname={pathname} />
      <WorkspaceMain data-organization-main>
        <WorkspaceHeader data-organization-header>
          <SidebarTrigger aria-label="Abrir o cerrar navegación" />
          <WorkspaceHeading>
            <div data-workspace-title-line>
              <WorkspaceTitle>{route.title}</WorkspaceTitle>
              <span data-workspace-organization>{current.display_name}</span>
            </div>
          </WorkspaceHeading>
        </WorkspaceHeader>
        <WorkspaceContent data-organization-content>{children}</WorkspaceContent>
      </WorkspaceMain>
    </WorkspaceShell>
  )
}

function OrganizationSidebar({
  basePath,
  teamHref,
  pathname,
}: {
  basePath: string
  teamHref: string
  pathname: string
}) {
  const { current, memberships, switchOrganization } = useOrganizationContext()
  const { setOpenMobile } = useSidebar()
  const teamActive = pathname.startsWith(`${basePath}/team`)

  function closeMobileNavigation() {
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="offcanvas" data-organization-sidebar>
      <SidebarHeader>
        <Link
          href={basePath}
          aria-label={`Ir al inicio de ${current.display_name}`}
          data-organization-brand
          onClick={closeMobileNavigation}
        >
          <ProductLockup
            product="studio"
            surface="dark"
            title="Allfit Studio"
            width={169}
            height={40}
          />
        </Link>
        <div data-sidebar-organization>
          <span>Organización activa</span>
          <strong>{current.display_name}</strong>
          <p data-sidebar-organization-meta>
            <span>{organizationTypeLabel(current.type_code)}</span>
            <span aria-hidden="true">·</span>
            <span>{membershipRoleSummary(current.roles)}</span>
          </p>
        </div>
        {memberships.length > 1 ? (
          <div data-sidebar-switcher>
            <label htmlFor="workspace-organization-switcher">Cambiar de organización</label>
            <Select
              value={current.organization_id}
              onValueChange={(value) => {
                if (value === null) return
                setOpenMobile(false)
                switchOrganization(value)
              }}
              items={memberships.map((membership) => ({
                label: `${membership.display_name} · ${membershipRoleSummary(membership.roles)}`,
                value: membership.organization_id,
              }))}
            >
              <SelectTrigger id="workspace-organization-switcher">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {memberships.map((membership) => (
                  <SelectItem key={membership.membership_id} value={membership.organization_id}>
                    {membership.display_name} · {membershipRoleSummary(membership.roles)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={basePath} onClick={closeMobileNavigation} />}
                  isActive={pathname === basePath}
                  aria-current={pathname === basePath ? 'page' : undefined}
                >
                  <FoundationIcon name="overview" decorative />
                  <span>Inicio</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={teamHref} onClick={closeMobileNavigation} />}
                  isActive={teamActive}
                  aria-current={teamActive ? 'page' : undefined}
                >
                  <FoundationIcon name="people" decorative />
                  <span>Equipo</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/account" onClick={closeMobileNavigation} />}>
              <FoundationIcon name="person" decorative />
              <span>Mi cuenta</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <LogoutForm variant="outline" />
      </SidebarFooter>
    </Sidebar>
  )
}
