/**
 * Sends a visitor who arrives without a language to the one their browser
 * prefers. `/` becomes `/es` or `/en`; `/privacidad` becomes `/es/privacidad`.
 * Paths that already carry a locale, and every static asset, pass untouched.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { localeFromPath, preferredLocale } from '@/lib/locale'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (localeFromPath(pathname)) return NextResponse.next()

  const locale = preferredLocale(request.headers.get('accept-language'))
  const target = request.nextUrl.clone()
  target.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(target)
}

export const config = {
  matcher: [
    '/((?!_next|images|brand|partners|favicon\\.ico|robots\\.txt|sitemap\\.xml|opengraph-image).*)',
  ],
}
