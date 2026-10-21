import Link from 'next/link'

import type { Dictionary } from '@/content'
import type { Locale } from '@/lib/locale'

import { Footer } from './footer'
import { Header } from './header'

/** A legal draft: marked as preliminary until a lawyer has reviewed it. */
export function LegalPage({
  locale,
  copy,
  document,
  path,
}: {
  locale: Locale
  copy: Dictionary
  document: Dictionary['legal']['privacy']
  path: string
}) {
  return (
    <>
      <Header locale={locale} copy={copy.nav} path={path} sections={false} />
      <main id="contenido" className="legal">
        <article className="legal__inner">
          <p className="legal__badge">{copy.legal.draft}</p>
          <h1>{document.title}</h1>
          <p className="legal__note">{copy.legal.draftNote}</p>
          <p className="legal__updated">{copy.legal.updated}</p>
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <Link className="pill-link legal__back" href={`/${locale}`}>
            {copy.legal.back}
          </Link>
        </article>
      </main>
      <Footer locale={locale} copy={copy} />
    </>
  )
}
