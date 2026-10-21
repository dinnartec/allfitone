import { describe, expect, test } from 'bun:test'

import { localeFromPath, preferredLocale } from './locale'

describe('preferredLocale', () => {
  test('Spanish when nothing is said', () => {
    expect(preferredLocale(null)).toBe('es')
    expect(preferredLocale('')).toBe('es')
  })

  test('the first supported language the browser asks for', () => {
    expect(preferredLocale('en-US,en;q=0.9,es;q=0.8')).toBe('en')
    expect(preferredLocale('es-CO,es;q=0.9,en;q=0.8')).toBe('es')
  })

  test('by weight, not by position', () => {
    expect(preferredLocale('es;q=0.4,en;q=0.9')).toBe('en')
  })

  test('Spanish when the browser asks only for languages the site lacks', () => {
    expect(preferredLocale('fr-FR,de;q=0.8')).toBe('es')
  })

  test('a language refused with q=0 is never chosen', () => {
    expect(preferredLocale('en;q=0,fr')).toBe('es')
  })
})

describe('localeFromPath', () => {
  test('reads the first segment', () => {
    expect(localeFromPath('/en')).toBe('en')
    expect(localeFromPath('/es/privacidad')).toBe('es')
  })

  test('nothing when the path has no locale', () => {
    expect(localeFromPath('/')).toBeNull()
    expect(localeFromPath('/privacidad')).toBeNull()
    expect(localeFromPath('/english')).toBeNull()
  })
})
