/**
 * Si hay algo que dibujar, preguntado **antes** de que exista el elemento.
 *
 * Es la trampa que `routine-cover-art` documenta en su propia cabecera y en la que se
 * cayó igualmente: un componente que no pinta nada sigue siendo un objeto elemento, así
 * que un `art ?? letra` nunca elegía la letra. En la pantalla de portada eso dejaba la
 * pestaña «Foto» con un cuadrado vacío, que se lee como un control que no hizo nada.
 */

import { describe, expect, test } from 'bun:test'

import {
  drawsSomething,
  iconCover,
  MUSCLE_COVER,
  PHOTO_COVER,
  type RoutineCover,
} from './routine-cover'

describe('drawsSomething', () => {
  test('no cover draws nothing, which is what makes a tile read as empty', () => {
    expect(drawsSomething(undefined, null)).toBe(false)
  })

  test('a photograph with nowhere to fetch it draws nothing, so the letter can', () => {
    expect(drawsSomething(PHOTO_COVER, null)).toBe(false)
    expect(drawsSomething(PHOTO_COVER, undefined)).toBe(false)
  })

  test('and one with an address does', () => {
    expect(drawsSomething(PHOTO_COVER, 'https://media.test/catalog/x.webp')).toBe(true)
  })

  test('an icon this build lost draws nothing rather than an empty square', () => {
    // El vocabulario vive en la base y se amplía por el final: una app vieja puede
    // recibir un nombre que no conoce, y entonces la letra es la respuesta.
    const unknown = { kind: 'icon', icon: 'yoga' } as unknown as RoutineCover
    expect(drawsSomething(unknown, null)).toBe(false)
  })

  test('and one it knows does', () => {
    expect(drawsSomething(iconCover('strength'), null)).toBe(true)
  })

  test('muscles always draw: the figure comes out of the exercises, not of an address', () => {
    expect(drawsSomething(MUSCLE_COVER, null)).toBe(true)
  })
})
