import type { ReactNode } from 'react'

/** What Next hands every page and layout under `app/[lang]`. */
export interface LocaleParams {
  params: Promise<{ lang: string }>
}

export interface LocaleLayoutProps extends LocaleParams {
  children: ReactNode
}
