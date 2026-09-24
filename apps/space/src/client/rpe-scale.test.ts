/**
 * `T-SP-RPE-01..06` — la escala de esfuerzo.
 *
 * Lo que se defiende aquí es que la escala **se explica sola**: cada peldaño dice qué se
 * está pidiendo, y el tramo de arriba lo dice en repeticiones que sobran, que es la
 * unidad con la que se prescribe.
 */

import { describe, expect, test } from 'bun:test'

import {
  RPE_EXPLAINER,
  RPE_LEVELS,
  RPE_MAX,
  RPE_MIN,
  RPE_UNSET,
  rpeCopy,
  rpeLevel,
  rpeShown,
} from './rpe-scale'

describe('RPE_LEVELS', () => {
  test('T-SP-RPE-01 son diez peldaños, del uno al diez y en ese orden', () => {
    expect(RPE_LEVELS).toHaveLength(RPE_MAX - RPE_MIN + 1)
    expect(RPE_LEVELS.map((level) => level.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('T-SP-RPE-02 ninguno se queda sin explicar', () => {
    for (const level of RPE_LEVELS) {
      expect(level.name.length).toBeGreaterThan(0)
      expect(level.detail.length).toBeGreaterThan(0)
    }
  })

  test('T-SP-RPE-03 de seis para arriba se cuenta en repeticiones que sobran', () => {
    // Es como se prescribe de verdad, y es lo que hace comprobable el número: un ocho
    // es «podías hacer dos más», no «me pareció duro».
    const counted = RPE_LEVELS.filter((level) => level.value >= 6)

    for (const level of counted) expect(level.detail).toContain('repetici')
    expect(rpeLevel(8)?.detail).toContain('dos')
    expect(rpeLevel(10)?.detail).toContain('ninguna')
  })

  test('T-SP-RPE-04 y el enunciado dice qué se mide antes de pedir el número', () => {
    expect(RPE_EXPLAINER).toContain('1 al 10')
    expect(RPE_EXPLAINER).toContain('quedado')
  })
})

describe('rpeShown y rpeCopy', () => {
  test('T-SP-RPE-05 sin marcar es una raya y no un cero', () => {
    // No haber pedido esfuerzo y pedir el mínimo son cosas distintas.
    expect(rpeShown(undefined)).toBe('—')
    expect(rpeShown(8)).toBe('8')
    expect(rpeCopy(undefined)).toBe(RPE_UNSET)
  })

  test('T-SP-RPE-06 el copy cambia con lo marcado', () => {
    expect(rpeCopy(8)).toBe('Muy duro. Quedan dos repeticiones.')
    expect(rpeCopy(8)).not.toBe(rpeCopy(9))
  })

  test('un número que la escala no tiene no inventa un peldaño', () => {
    expect(rpeLevel(11)).toBeUndefined()
    expect(rpeCopy(0)).toBe(RPE_UNSET)
  })
})
