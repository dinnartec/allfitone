import type { ReactNode } from 'react'

import { TeamSectionNavigation } from '@/components/team-section-navigation'

export default function TeamLayout({ children }: { children: ReactNode }) {
  return (
    <section data-team-section>
      <TeamSectionNavigation />
      <div data-team-section-content>{children}</div>
    </section>
  )
}
