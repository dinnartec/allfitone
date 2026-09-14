import type { Metadata } from 'next'

import { CredentialVerification } from '@/components/credential-verification'

export const metadata: Metadata = {
  title: 'Verificación de títulos · Allfit Backoffice',
}

export default function VerificationsPage() {
  return <CredentialVerification />
}
