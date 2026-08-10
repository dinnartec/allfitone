import type { ReactNode } from 'react'

import { OrganizationContextBoundary } from '@/components/organization-context'

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  return (
    <OrganizationContextBoundary key={organizationId} organizationId={organizationId}>
      {children}
    </OrganizationContextBoundary>
  )
}
