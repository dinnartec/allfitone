import type { Metadata } from 'next'

import { ScopeDefinitionPublication } from '@/components/scope-definition-publication'

export const metadata: Metadata = {
  title: 'Definiciones de permiso · Allfit Backoffice',
}

export default function ScopeDefinitionsPage() {
  return <ScopeDefinitionPublication />
}
