import type { Metadata } from 'next'

import { OrganizationFile } from '@/components/organization-file'

export const metadata: Metadata = {
  title: 'Ficha del gimnasio · Allfit Backoffice',
}

export default async function OrganizationFilePage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  return <OrganizationFile organizationId={organizationId} />
}
