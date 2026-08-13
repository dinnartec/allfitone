import type { ReactNode } from 'react'

import { OrganizationWorkspaceShell } from '@/components/organization-workspace-shell'

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <OrganizationWorkspaceShell>{children}</OrganizationWorkspaceShell>
}
