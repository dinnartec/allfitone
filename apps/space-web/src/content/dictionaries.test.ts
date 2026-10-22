import { describe, expect, test } from 'bun:test'

import { en } from './en'
import { es } from './es'

/** Every leaf path of a dictionary, with its value. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, `${path}[${String(index)}]`))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      leaves(item, path ? `${path}.${key}` : key),
    )
  }
  return [[path, value]]
}

describe('dictionaries', () => {
  test('Spanish and English say the same things', () => {
    expect(leaves(en).map(([path]) => path)).toEqual(leaves(es).map(([path]) => path))
  })

  test('no text is left empty', () => {
    for (const dictionary of [es, en]) {
      const empty = leaves(dictionary).filter(
        ([, value]) => typeof value === 'string' && value.trim() === '',
      )
      expect(empty).toEqual([])
    }
  })

  test('every text starts with a capital letter or a number', () => {
    for (const dictionary of [es, en]) {
      const lower = leaves(dictionary).filter(
        ([path, value]) =>
          typeof value === 'string' && !path.endsWith('href') && /^[a-zà-ÿ]/.test(value),
      )
      expect(lower).toEqual([])
    }
  })
})
