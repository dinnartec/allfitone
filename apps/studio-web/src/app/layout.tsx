import type { Metadata } from 'next'
import { Barlow_Condensed, Manrope } from 'next/font/google'
import type { ReactNode } from 'react'

import { SessionGuard } from '@/components/session-guard'

import '@allfitone/react/tokens.css'
import '@allfitone/react/app.css'
import '@allfitone/react/styles.css'
import './studio.composition.css'

const display = Barlow_Condensed({
  subsets: ['latin'],
  variable: '--afo-app-font-display',
  weight: ['500', '600', '700'],
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--afo-app-font-body',
})

export const metadata: Metadata = {
  title: 'Allfit Studio',
  description: 'Gestión de espacios, equipos y servicios en Allfit Studio.',
  icons: {
    icon: [
      {
        url: '/brand/allfit-one/favicon/allfit-one-favicon-cyan.svg',
        type: 'image/svg+xml',
      },
    ],
    shortcut: '/brand/allfit-one/favicon/allfit-one-favicon-cyan.svg',
  },
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" data-afo-theme="light" className={`${display.variable} ${body.variable}`}>
      <body>
        <SessionGuard>{children}</SessionGuard>
      </body>
    </html>
  )
}
