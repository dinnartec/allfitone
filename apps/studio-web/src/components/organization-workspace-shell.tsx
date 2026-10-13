'use client'

import { BrandLogo, ProductWordmark } from '@allfitone/react/brand'
import { Badge } from '@allfitone/react/components/badge'
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
  SidebarSeparator,
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
    // Below 1100px the expanded rail takes a fifth of the viewport from the
    // content it frames, and the offcanvas drawer is still premature there.
    <WorkspaceShell data-organization-shell collapseBelow={1100}>
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
  const { setOpenMobile, state, isMobile } = useSidebar()
  // On the icon rail the wordmark does not fit. Swapping to the mark keeps the
  // brand legible instead of clipping the lockup mid-letter.
  const railed = state === 'collapsed' && !isMobile
  const organizationHref = `${basePath}/organization`
  const organizationActive = pathname.startsWith(organizationHref)
  const teamHref = `${basePath}/team`
  const teamActive = pathname.startsWith(teamHref)
  const clientsHref = `${basePath}/clients`
  const clientsActive = pathname.startsWith(clientsHref)
  const billingHref = `${basePath}/billing`
  const billingActive = pathname.startsWith(billingHref)

  function closeMobileNavigation() {
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" data-afo-theme="dark" data-organization-sidebar>
      <SidebarHeader>
        <Link
          href={basePath}
          aria-label={`Ir al inicio de ${current.display_name}`}
          data-organization-brand
          onClick={closeMobileNavigation}
        >
          {railed ? (
            <BrandLogo variant="cyan" title="Allfit Studio" width={32} height={32} />
          ) : (
            <ProductWordmark
              product="studio"
              surface="dark"
              title="Allfit Studio"
              width={138}
              height={28}
            />
          )}
        </Link>
        {/* The organization is named once. It used to appear in a static block,
            again inside the switcher, again in the header bar and again on the
            page, competing with the content for attention.

            Every label here comes from a Design System component: the sidebar
            wrapper resolves `text-sidebar-foreground` against the light theme,
            so a bare element would inherit ink-on-ink and disappear. */}
        {!railed ? (
          <div data-sidebar-organization>
            {memberships.length > 1 ? (
              <div data-sidebar-switcher>
                <SidebarGroupLabel
                  render={<label htmlFor="workspace-organization-switcher" />}
                  data-sidebar-organization-label
                >
                  Cambiar de organización
                </SidebarGroupLabel>
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
                  {/* Studio placed both, so Studio marks them: the CSS sizes the
                      trigger to the rail and gives the value its ellipsis. */}
                  <SelectTrigger id="workspace-organization-switcher" data-switcher-trigger>
                    <SelectValue data-switcher-value />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {memberships.map((membership) => (
                      <SelectItem key={membership.membership_id} value={membership.organization_id}>
                        {/* The name alone. `SelectContent` is pinned to the
                            trigger's width, which is 166px in this rail, and
                            appending the roles took the label to 259px — so the
                            organization name was cut off to make room for a
                            role the badges below already show. */}
                        {membership.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <SidebarGroupLabel data-sidebar-organization-name>
                {current.display_name}
              </SidebarGroupLabel>
            )}
            <p data-sidebar-organization-meta>
              <Badge variant="secondary">{organizationTypeLabel(current.type_code)}</Badge>
              <Badge variant="secondary">{membershipRoleSummary(current.roles)}</Badge>
            </p>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarSeparator data-sidebar-rule />

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
                  render={<Link href={organizationHref} onClick={closeMobileNavigation} />}
                  isActive={organizationActive}
                  aria-current={organizationActive ? 'page' : undefined}
                >
                  <FoundationIcon name="organization" decorative />
                  <span>Organización</span>
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={clientsHref} onClick={closeMobileNavigation} />}
                  isActive={clientsActive}
                  aria-current={clientsActive ? 'page' : undefined}
                >
                  <FoundationIcon name="person" decorative />
                  <span>Clientes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* Shown to everybody; the screen itself says no when the role has no
                  `manage_billing`, and PostgreSQL says it again underneath. Hiding the
                  entry would need a second copy of that grant here, which is the drift
                  the capability catalogue exists to avoid. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={billingHref} onClick={closeMobileNavigation} />}
                  isActive={billingActive}
                  aria-current={billingActive ? 'page' : undefined}
                >
                  <FoundationIcon name="business" decorative />
                  <span>Cobros</span>
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
        {!railed ? <LogoutForm variant="outline" /> : null}
      </SidebarFooter>
    </Sidebar>
  )
}
