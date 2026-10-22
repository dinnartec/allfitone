import Image from 'next/image'
import Link from 'next/link'

import type { Dictionary } from '@/content'
import { LOCALES, type Locale } from '@/lib/locale'

/** The language switch keeps the visitor on the same page in the other language. */
export function Languages({
  locale,
  path,
  label,
}: {
  locale: Locale
  path: string
  label: string
}) {
  return (
    <nav className="langs" aria-label={label}>
      {LOCALES.map((option) => (
        <Link
          key={option}
          href={`/${option}${path}`}
          hrefLang={option}
          lang={option}
          aria-current={option === locale ? 'true' : undefined}
        >
          {option.toUpperCase()}
        </Link>
      ))}
    </nav>
  )
}

export function Header({
  locale,
  copy,
  path = '',
  sections = true,
}: {
  locale: Locale
  copy: Dictionary['nav']
  path?: string
  sections?: boolean
}) {
  const home = `/${locale}`
  const links = [
    { id: 'app', label: copy.features },
    { id: 'programas', label: copy.programs },
    { id: 'privacidad', label: copy.privacy },
    { id: 'gimnasios', label: copy.gyms },
  ]
  return (
    <header className="header">
      <div className="wrap header__bar">
        <Link className="header__home" href={home} aria-label={copy.home}>
          <Image
            src="/brand/allfit-space-lockup-on-dark.svg"
            alt=""
            width={168}
            height={41}
            priority
          />
        </Link>
        <div className="header__nav">
          {sections ? (
            <nav aria-label={copy.label}>
              <ul className="header__links">
                {links.map((link) => (
                  <li key={link.id}>
                    <a href={`#${link.id}`}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <Languages locale={locale} path={path} label={copy.language} />
        </div>
      </div>
    </header>
  )
}
