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
import { membershipRoleSummary } from '@/lib/membership-roles'
import { resolveWorkspaceRoute } from '@/lib/organization-navigation'

export function OrganizationWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { current } = useOrganizationContext()
  const basePath = `/organizations/${current.organization_id}`
  const route = resolveWorkspaceRoute(pathname, current.organization_id)

  return (
    <WorkspaceShell data-organization-shell>
      <OrganizationSidebar basePath={basePath} pathname={pathname} />
      <WorkspaceMain data-organization-main>
        <WorkspaceHeader data-organization-header>
          <SidebarTrigger aria-label="Abrir o cerrar navegación" />
          <WorkspaceHeading>
            <WorkspaceTitle>{route.title}</WorkspaceTitle>
          </WorkspaceHeading>
        </WorkspaceHeader>
        <WorkspaceContent data-organization-content>{children}</WorkspaceContent>
      </WorkspaceMain>
    </WorkspaceShell>
  )
}

function OrganizationSidebar({ basePath, pathname }: { basePath: string; pathname: string }) {
  const { current, memberships, switchOrganization } = useOrganizationContext()
  const { setOpenMobile } = useSidebar()
  const teamHref = `${basePath}/team`
  const teamActive = pathname.startsWith(teamHref)

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
        {/* The organization is named once. It used to appear in a static block,
            again inside the switcher, again in the header bar and again on the
            page, competing with the content for attention. */}
        <div data-sidebar-organization>
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
                  label: membership.display_name,
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
          ) : (
            <strong>{current.display_name}</strong>
          )}
          <p data-sidebar-organization-meta>
            <span>{organizationTypeLabel(current.type_code)}</span>
            <span aria-hidden="true">·</span>
            <span>{membershipRoleSummary(current.roles)}</span>
          </p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
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
