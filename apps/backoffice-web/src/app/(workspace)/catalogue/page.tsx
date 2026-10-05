import type { Metadata } from 'next'

import { GlobalCatalogue } from '@/components/global-catalogue'

export const metadata: Metadata = {
  title: 'Catálogo global · Allfit Backoffice',
}

export default function GlobalCataloguePage() {
  return <GlobalCatalogue />
}
