import type { Metadata } from 'next'

import { ErasureRequests } from '@/components/erasure-requests'

export const metadata: Metadata = {
  title: 'Solicitudes de eliminación · Allfit Backoffice',
}

export default function ErasureRequestsPage() {
  return <ErasureRequests />
}
