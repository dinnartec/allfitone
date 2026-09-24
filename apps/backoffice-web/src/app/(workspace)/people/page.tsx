import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SupportPeopleSearch } from '@/components/support-people-search'

export const metadata: Metadata = {
  title: 'Personas · Allfit Backoffice',
}

export default function SupportPeoplePage() {
  return (
    <Suspense>
      <SupportPeopleSearch />
    </Suspense>
  )
}
