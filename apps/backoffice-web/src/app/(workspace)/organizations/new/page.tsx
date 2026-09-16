import type { Metadata } from 'next'

import { OrganizationHandoverForm } from '@/components/organization-handover-form'

export const metadata: Metadata = {
  title: 'Crear un gimnasio · Allfit Backoffice',
}

export default function NewOrganizationPage() {
  return <OrganizationHandoverForm />
}
