import type { ReactNode } from 'react'

import { BackofficeSessionGate } from '@/components/backoffice-session-gate'

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <BackofficeSessionGate>{children}</BackofficeSessionGate>
}
