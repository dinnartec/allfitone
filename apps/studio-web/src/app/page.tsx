import { Suspense } from 'react'

import { StudioEntry } from '@/components/studio-entry'

/**
 * The boundary exists because StudioEntry reads search params, not to show
 * anything. Its fallback is empty on purpose: the server cannot read the stored
 * session, so a loading card here would paint at everyone, including the
 * reloads that resolve before the first frame is done. StudioEntry announces
 * the wait itself, once the wait has earned it.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <StudioEntry />
    </Suspense>
  )
}
