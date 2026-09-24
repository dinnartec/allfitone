import type { Metadata } from 'next'
import { Suspense } from 'react'

import { OrganizationDirectory } from '@/components/organization-directory'

export const metadata: Metadata = {
  title: 'Gimnasios · Allfit Backoffice',
}

export default function OrganizationsPage() {
  return (
    <Suspense>
      <OrganizationDirectory />
    </Suspense>
  )
}
