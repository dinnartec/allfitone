import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SupportPersonCard } from '@/components/support-person-card'

export const metadata: Metadata = {
  title: 'Estado operativo · Allfit Backoffice',
}

export default async function SupportPersonPage({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  return (
    <Suspense>
      <SupportPersonCard personId={personId} />
    </Suspense>
  )
}
