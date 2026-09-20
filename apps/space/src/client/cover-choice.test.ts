/**
 * Las transiciones de la hoja de portada, que son donde se rompió.
 *
 * La regla que fijan estas pruebas es una: **la pestaña y la previa dicen siempre lo
 * mismo**. Se escribieron después de ver la hoja abrir con «Músculos» marcado y la
 * tarjeta dibujando la letra, que es lo que hacía pensar que el selector no funcionaba.
 */

import { describe, expect, test } from 'bun:test'

import { coverForTab, openingCover, openingTab } from './cover-choice'
import { COVER_ICONS, iconCover, MUSCLE_COVER, PHOTO_COVER } from './routine-cover'

describe('coverForTab', () => {
  test('each tab previews its own kind, so the control and the card agree', () => {
    expect(coverForTab('muscles', undefined)).toEqual(MUSCLE_COVER)
    expect(coverForTab('photo', undefined)).toEqual(PHOTO_COVER)
    expect(coverForTab('icon', undefined).kind).toBe('icon')
  })

  test('going back to icons brings back the one that was chosen, not the first', () => {
    // Pasar por «Foto» y volver tiene que devolver el icono que había. Devolver el
    // primero de la fila sería perder la elección por mirar otra pestaña.
    expect(coverForTab('icon', iconCover('mountain'))).toEqual(iconCover('mountain'))
  })

  test('and the first of the row when none was ever chosen, which is the one on screen', () => {
    const first = COVER_ICONS[0]
    expect(first).toBeDefined()
    expect(coverForTab('icon', MUSCLE_COVER)).toEqual(iconCover(first?.icon ?? 'strength'))
    expect(coverForTab('icon', undefined)).toEqual(iconCover(first?.icon ?? 'strength'))
  })
})

describe('opening the sheet', () => {
  test('it opens on the kind the programme already wears', () => {
    expect(openingTab(iconCover('strength'))).toBe('icon')
    expect(openingTab(PHOTO_COVER)).toBe('photo')
    expect(openingTab(MUSCLE_COVER)).toBe('muscles')
  })

  test('and on muscles when it wears nothing, which is the one that draws itself', () => {
    expect(openingTab(undefined)).toBe('muscles')
  })

  test('the card never opens empty under a tab that says otherwise', () => {
    // El fallo exacto: la pestaña decía «Músculos» y la tarjeta dibujaba la letra, así
    // que el control parecía muerto hasta pulsar la pestaña que ya estaba pulsada.
    expect(openingCover(undefined)).toEqual(MUSCLE_COVER)
  })

  test('and what it opens with is always what its tab would preview', () => {
    for (const held of [undefined, MUSCLE_COVER, PHOTO_COVER, iconCover('mountain')]) {
      expect(openingCover(held)).toEqual(coverForTab(openingTab(held), held))
    }
  })

  test('it opens on exactly what is applied, so nothing looks changed before it is', () => {
    expect(openingCover(iconCover('mountain'))).toEqual(iconCover('mountain'))
  })
})
