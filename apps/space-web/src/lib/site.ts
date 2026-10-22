import { LOCALES, type Locale } from './locale'

export const SITE_URL = 'https://space.allfit.one'

/** Canonical and alternate URLs of one page in every language. */
export function alternates(locale: Locale, path: string) {
  return {
    canonical: `${SITE_URL}/${locale}${path}`,
    languages: Object.fromEntries(
      LOCALES.map((option) => [option, `${SITE_URL}/${option}${path}`]),
    ),
  }
}
