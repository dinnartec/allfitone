import type { Metadata } from 'next'

import { AccessLog } from '@/components/access-log'

export const metadata: Metadata = {
  title: 'Registro de accesos · Allfit Backoffice',
}

export default function AccessLogPage() {
  return <AccessLog />
}
