import type { Metadata } from 'next'

import { AttentionPanel } from '@/components/attention-panel'

export const metadata: Metadata = {
  title: 'Inicio · Allfit Backoffice',
}

export default function PanelPage() {
  return <AttentionPanel />
}
