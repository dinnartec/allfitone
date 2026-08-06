import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Allfit Studio',
  description: 'Gestión profesional para entrenadores, gimnasios y estudios.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
