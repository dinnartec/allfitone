import type { Metadata } from 'next'

import { OrganizationDirectory } from '@/components/organization-directory'

export const metadata: Metadata = {
  title: 'Gimnasios · Allfit Backoffice',
}

export default function OrganizationsPage() {
  return <OrganizationDirectory />
}
