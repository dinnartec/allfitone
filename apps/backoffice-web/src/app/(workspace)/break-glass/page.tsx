import type { Metadata } from 'next'

import { BreakGlassReviewQueue } from '@/components/break-glass-review-queue'
import { BreakGlassWindows } from '@/components/break-glass-windows'

export const metadata: Metadata = {
  title: 'Acceso excepcional · Allfit Backoffice',
}

export default function BreakGlassPage() {
  return (
    <>
      <BreakGlassWindows />
      <BreakGlassReviewQueue />
    </>
  )
}
