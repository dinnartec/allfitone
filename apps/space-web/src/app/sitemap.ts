import type { MetadataRoute } from 'next'

import { LOCALES } from '@/lib/locale'
import { alternates } from '@/lib/site'

const PATHS = ['', '/privacidad', '/terminos']

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.flatMap((path) =>
    LOCALES.map((locale) => {
      const { canonical, languages } = alternates(locale, path)
      return { url: canonical, alternates: { languages }, priority: path ? 0.3 : 1 }
    }),
  )
}
