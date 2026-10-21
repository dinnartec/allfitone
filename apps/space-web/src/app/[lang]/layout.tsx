import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Manrope } from 'next/font/google'
import { notFound } from 'next/navigation'

import { Motion } from '@/components/motion'
import { dictionaryFor } from '@/content'
import type { LocaleLayoutProps, LocaleParams } from '@/lib/route'
import { isLocale, LOCALES } from '@/lib/locale'
import { alternates, SITE_URL } from '@/lib/site'

import '@allfitone/react/tokens.css'
import '../space.css'

const display = Barlow_Condensed({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700', '800'],
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
})

export const dynamicParams = false

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export const viewport: Viewport = {
  themeColor: '#05090F',
  colorScheme: 'dark',
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  const copy = dictionaryFor(lang)
  return {
    metadataBase: new URL(SITE_URL),
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: alternates(lang, ''),
    icons: { icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }] },
    openGraph: {
      type: 'website',
      siteName: 'Allfit Space',
      title: copy.meta.title,
      description: copy.meta.description,
      locale: lang === 'es' ? 'es_CO' : 'en_US',
      images: [{ url: '/images/og.jpg', width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const copy = dictionaryFor(lang)
  return (
    <html lang={lang} data-afo-theme="dark" className={`${display.variable} ${body.variable}`}>
      <body>
        <a className="skip" href="#contenido">
          {copy.nav.skip}
        </a>
        <div className="progress" aria-hidden="true" />
        {children}
        <Motion />
      </body>
    </html>
  )
}
