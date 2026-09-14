import type { Metadata } from 'next'

import { OrganizationHandover } from '@/components/organization-handover'

export const metadata: Metadata = {
  title: 'Entrega del gimnasio · Allfit Backoffice',
}

export default async function OrganizationHandoverPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  return <OrganizationHandover organizationId={organizationId} />
}
