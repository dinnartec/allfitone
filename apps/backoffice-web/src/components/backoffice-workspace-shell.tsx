'use client'

/**
 * The authenticated Backoffice shell.
 *
 * `HU-BO-028` is the first screen to land behind the login, so it carries the
 * navigation, the layout and the forbidden state that the whole product will
 * reuse — the specification names this as a decision to take deliberately rather
 * than let appear by accident.
 *
 * The sidebar lists what the operator can reach, never what they are allowed to
 * do. Reachability is decided by the API on every request, in its own
 * transaction: hiding a link is presentation, not authorization, and a duty that
 * expires mid-session must fail the next call rather than the next render.
 */

import { BrandLogo, ProductWordmark } from '@allfitone/react/brand'
import { Button } from '@allfitone/react/components/button'
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

import { backofficeApi } from '@/lib/backoffice-api'

interface WorkspaceRoute {
  href: string
  title: string
  icon: 'permissions' | 'people' | 'operation'
}

const ROUTES: readonly WorkspaceRoute[] = [
  { href: '/people', title: 'Personas', icon: 'people' },
  { href: '/break-glass', title: 'Acceso excepcional', icon: 'permissions' },
  { href: '/diagnosis', title: 'Diagnóstico técnico', icon: 'operation' },
  { href: '/team', title: 'Equipo de Allfit', icon: 'permissions' },
  { href: '/catalogue/result-contracts', title: 'Catálogo global', icon: 'operation' },
  { href: '/permissions', title: 'Definiciones de permiso', icon: 'permissions' },
]

export function resolveBackofficeRoute(pathname: string): WorkspaceRoute {
  return (
    ROUTES.find((route) => pathname === route.href || pathname.startsWith(`${route.href}/`)) ?? {
      href: '/team',
      title: 'Backoffice',
      icon: 'people',
    }
  )
}

export function BackofficeWorkspaceShell({
  children,
  operatorName,
}: {
  children: ReactNode
  operatorName: string
}) {
  const pathname = usePathname()
  const route = resolveBackofficeRoute(pathname)

  return (
    // The rail steals a fifth of a narrow viewport from the content it frames,
    // and the offcanvas drawer is still premature there.
    <WorkspaceShell data-backoffice-shell collapseBelow={1100}>
      <BackofficeSidebar pathname={pathname} operatorName={operatorName} />
      <WorkspaceMain data-backoffice-main>
        <WorkspaceHeader data-backoffice-header>
          <SidebarTrigger aria-label="Abrir o cerrar navegación" />
          <WorkspaceHeading>
            <WorkspaceTitle>{route.title}</WorkspaceTitle>
          </WorkspaceHeading>
        </WorkspaceHeader>
        <WorkspaceContent data-backoffice-content>{children}</WorkspaceContent>
      </WorkspaceMain>
    </WorkspaceShell>
  )
}

function BackofficeSidebar({ pathname, operatorName }: { pathname: string; operatorName: string }) {
  const { setOpenMobile, state, isMobile } = useSidebar()
  const railed = state === 'collapsed' && !isMobile

  function closeMobileNavigation() {
    setOpenMobile(false)
  }

  async function signOut() {
    try {
      await backofficeApi.logout('manual')
    } finally {
      window.location.assign('/')
    }
  }

  return (
    <Sidebar collapsible="icon" data-afo-theme="dark" data-backoffice-sidebar>
      <SidebarHeader>
        <Link
          href="/team"
          aria-label="Ir al inicio de Allfit Backoffice"
          data-backoffice-brand
          onClick={closeMobileNavigation}
        >
          {railed ? (
            <BrandLogo variant="cyan" title="Allfit Backoffice" width={32} height={32} />
          ) : (
            <ProductWordmark
              product="backoffice"
              surface="dark"
              title="Allfit Backoffice"
              width={150}
              height={28}
            />
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!railed ? <SidebarGroupLabel>Operación</SidebarGroupLabel> : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {ROUTES.map((route) => (
                <SidebarMenuItem key={route.href}>
                  <SidebarMenuButton
                    isActive={pathname === route.href || pathname.startsWith(`${route.href}/`)}
                    tooltip={route.title}
                    render={<Link href={route.href} onClick={closeMobileNavigation} />}
                  >
                    <FoundationIcon name={route.icon} />
                    <span>{route.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {!railed ? <SidebarGroupLabel>{operatorName}</SidebarGroupLabel> : null}
        <Button type="button" variant="ghost" size="sm" onClick={signOut}>
          Cerrar sesión
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
