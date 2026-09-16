import type { Metadata } from 'next'

import { PlatformPlans } from '@/components/platform-plans'

export const metadata: Metadata = {
  title: 'Planes de Allfit · Allfit Backoffice',
}

export default function PlansPage() {
  return <PlatformPlans />
}
