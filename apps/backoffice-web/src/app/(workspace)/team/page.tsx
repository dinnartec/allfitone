import type { Metadata } from 'next'

import { PlatformAccess } from '@/components/platform-access'

export const metadata: Metadata = {
  title: 'Equipo de Allfit · Allfit Backoffice',
}

export default function TeamAccessPage() {
  return <PlatformAccess />
}
