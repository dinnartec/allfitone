import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { content, isLanguage, languages, ogLocales, siteUrl } from '@/lib/content'
import { body, display } from '@/lib/fonts'

import '@allfitone/react/tokens.css'
import '@allfitone/react/app.css'
import '@allfitone/react/styles.css'
import '../space.composition.css'

type LanguageParams = { params: Promise<{ lang: string }> }

/** Only the published languages exist; any other first segment is a 404. */
export const dynamicParams = false

export function generateStaticParams(): { lang: string }[] {
  return languages.map((lang) => ({ lang }))
}

export async function generateMetadata({ params }: LanguageParams): Promise<Metadata> {
  const { lang } = await params
  if (!isLanguage(lang)) notFound()
  const copy = content[lang].metadata

  return {
    metadataBase: new URL(siteUrl),
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: `/${lang}`,
      // The root redirects to Spanish and may later negotiate, so it is the x-default.
      languages: { es: '/es', en: '/en', 'x-default': '/' },
    },
    openGraph: {
      type: 'website',
      locale: ogLocales[lang],
      alternateLocale: languages.filter((other) => other !== lang).map((other) => ogLocales[other]),
      siteName: 'Allfit Space',
      title: copy.title,
      description: copy.description,
      url: `/${lang}`,
    },
    icons: {
      icon: [
        {
          url: '/brand/allfit-one/favicon/allfit-one-favicon-ink.svg',
          type: 'image/svg+xml',
        },
      ],
      shortcut: '/brand/allfit-one/favicon/allfit-one-favicon-ink.svg',
    },
  }
}

export default async function RootLayout({
  children,
  params,
}: Readonly<LanguageParams & { children: ReactNode }>) {
  const { lang } = await params
  if (!isLanguage(lang)) notFound()

  return (
    <html lang={lang} data-afo-theme="dark" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  )
}
