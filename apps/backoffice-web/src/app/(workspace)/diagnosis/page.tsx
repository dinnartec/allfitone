import type { Metadata } from 'next'

import { SupportDiagnosis } from '@/components/support-diagnosis'

export const metadata: Metadata = {
  title: 'Diagnóstico técnico · Allfit Backoffice',
}

export default function SupportDiagnosisPage() {
  return <SupportDiagnosis />
}
