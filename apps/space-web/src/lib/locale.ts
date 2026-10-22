/**
 * The two languages the site speaks, and how a visitor lands on one.
 *
 * Spanish is the default: Space launches in Colombia. English is offered to
 * whoever asks for it first. The negotiation is a few lines on purpose — a
 * library would buy region fallbacks the site does not have.
 */

export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'es'

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

/** The supported language an `Accept-Language` header prefers, by weight. */
export function preferredLocale(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE
  const ranked = header
    .split(',')
    .map((part, position) => {
      const [tag = '', ...params] = part.trim().split(';')
      const weight = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
      const quality = weight ? Number(weight.slice(2)) : 1
      return { language: tag.toLowerCase().split('-')[0] ?? '', quality, position }
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.position - right.position)
  for (const { language } of ranked) {
    if (isLocale(language)) return language
  }
  return DEFAULT_LOCALE
}

/** The locale a path already carries in its first segment, if any. */
export function localeFromPath(pathname: string): Locale | null {
  const [, first = ''] = pathname.split('/')
  return isLocale(first) ? first : null
}
