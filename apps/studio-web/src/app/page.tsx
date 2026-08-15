import { Suspense } from 'react'

import { StudioEntry } from '@/components/studio-entry'
import { LoadingStage } from '@/components/studio-frame'

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingStage />}>
      <StudioEntry />
    </Suspense>
  )
}
