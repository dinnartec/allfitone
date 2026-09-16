import type { Metadata } from 'next'

import { AttentionPanel } from '@/components/attention-panel'
import { BusinessPanel } from '@/components/business-panel'

export const metadata: Metadata = {
  title: 'Inicio · Allfit Backoffice',
}

/**
 * What needs attention comes first because it asks somebody to act; how the
 * business is going comes second and refuses on its own without taking the
 * screen down with it.
 */
export default function PanelPage() {
  return (
    <div data-panel-home>
      <AttentionPanel />
      <BusinessPanel />
    </div>
  )
}
