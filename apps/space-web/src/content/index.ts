import type { Locale } from '@/lib/locale'

import { en } from './en'
import { es, type Dictionary } from './es'

export type { Dictionary }

const dictionaries: Record<Locale, Dictionary> = { es, en }

export function dictionaryFor(locale: Locale): Dictionary {
  return dictionaries[locale]
}
