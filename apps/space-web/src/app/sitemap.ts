import type { MetadataRoute } from 'next'

import { languages, siteUrl } from '@/lib/content'

/** Lists each language URL once, with its translation as an hreflang alternate. */
export default function sitemap(): MetadataRoute.Sitemap {
  return languages.map((language) => ({
    url: `${siteUrl}/${language}`,
    changeFrequency: 'monthly',
    priority: 1,
    alternates: {
      languages: Object.fromEntries(languages.map((other) => [other, `${siteUrl}/${other}`])),
    },
  }))
}
