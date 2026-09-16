import type { Metadata } from 'next'

import { BreakGlassWindows } from '@/components/break-glass-windows'

export const metadata: Metadata = {
  title: 'Acceso excepcional · Allfit Backoffice',
}

export default function BreakGlassPage() {
  return <BreakGlassWindows />
}
