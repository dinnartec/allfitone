/**
 * La previa promete «así se verá tu Home», y lo que la hace verdad o mentira es esto.
 *
 * La prueba que importa es el reparto de series: contarle una serie a todos los músculos
 * que un ejercicio toca convierte trece series en treinta y una, y el número deja de ser
 * el trabajo hecho para pasar a ser un recuento de menciones.
 */

import { describe, expect, test } from 'bun:test'

import {
  dominantRegion,
  MUSCLES_SHOWN,
  previewFigures,
  previewTitle,
  setsPerMuscle,
} from './home-preview'
import type { Movement, MuscleTerm } from './content'
import type { WorkingStep } from './routine-draft'

const MUSCLES: readonly MuscleTerm[] = [
  { code: 'chest', name: 'Pecho', region: 'upper', body_slug: 'chest' },
  { code: 'shoulders', name: 'Hombros', region: 'upper', body_slug: 'deltoid' },
  { code: 'triceps', name: 'Tríceps', region: 'upper', body_slug: 'triceps' },
]

const MOVEMENTS: readonly Movement[] = [
  {
    id: 'm1',
    discipline_code: 'strength',
    name: 'Press de banca',
    muscles: ['chest', 'triceps'],
    equipment: [],
    demo_url: null,
  },
  {
    id: 'm2',
    discipline_code: 'strength',
    name: 'Press militar',
    muscles: ['shoulders', 'triceps'],
    equipment: [],
    demo_url: null,
  },
  {
    id: 'm3',
    discipline_code: 'strength',
    name: 'Fondos',
    muscles: ['triceps'],
    equipment: [],
    demo_url: null,
  },
  {
    id: 'm4',
    discipline_code: 'strength',
    name: 'Sin curar',
    muscles: [],
    equipment: [],
    demo_url: null,
  },
]

function step(movementId: string, sets: number, position = 1): WorkingStep {
  return {
    position,
    movementId,
    name: MOVEMENTS.find((one) => one.id === movementId)?.name ?? '',
    sets: Array.from({ length: sets }, () => ({ kind: 'normal' as const, reps: 10 })),
  }
}

describe('setsPerMuscle', () => {
  test('a set belongs to the primary muscle and to no other', () => {
    // Press de banca trabaja pecho y tríceps, y sus seis series son seis y no doce.
    const load = setsPerMuscle([step('m1', 6)], MOVEMENTS, MUSCLES)

    expect(load).toEqual([{ code: 'chest', name: 'Pecho', sets: 6 }])
  })

  test('adds up across exercises and answers heaviest first', () => {
    const load = setsPerMuscle(
      [step('m1', 6, 1), step('m2', 4, 2), step('m3', 3, 3)],
      MOVEMENTS,
      MUSCLES,
    )

    expect(load.map((one) => [one.name, one.sets])).toEqual([
      ['Pecho', 6],
      ['Hombros', 4],
      ['Tríceps', 3],
    ])
  })

  test('breaks a tie by name, so the card does not shuffle between keystrokes', () => {
    // La previa se redibuja con cada tecla del nombre. Dos músculos empatados que
    // cambiasen de sitio la harían parpadear sin que nadie tocase la rutina.
    const load = setsPerMuscle([step('m2', 4, 1), step('m1', 4, 2)], MOVEMENTS, MUSCLES)

    expect(load.map((one) => one.name)).toEqual(['Hombros', 'Pecho'])
  })

  test('an exercise with no curated muscles contributes to nobody', () => {
    // Es el estado normal de un catálogo que crece. Contarlo como «otros» sería
    // inventarse un grupo muscular.
    const load = setsPerMuscle([step('m4', 5)], MOVEMENTS, MUSCLES)

    expect(load).toEqual([])
  })

  test('an exercise with no sets yet does not appear as a muscle with zero', () => {
    const load = setsPerMuscle([step('m1', 0)], MOVEMENTS, MUSCLES)

    expect(load).toEqual([])
  })

  test('names a muscle by its code when the catalogue has not named it', () => {
    const load = setsPerMuscle([step('m1', 2)], MOVEMENTS, [])

    expect(load).toEqual([{ code: 'chest', name: 'chest', sets: 2 }])
  })

  test('shows three, which is what fits without cutting one in half', () => {
    expect(MUSCLES_SHOWN).toBe(3)
  })
})

describe('previewFigures', () => {
  test('says the exercises and the sets', () => {
    expect(previewFigures([step('m1', 6, 1), step('m2', 4, 2)])).toBe('2 ejercicios · 10 series')
  })

  test('singular when there is one of each', () => {
    expect(previewFigures([step('m1', 1)])).toBe('1 ejercicio · 1 serie')
  })

  test('says nothing about sets there are none of', () => {
    expect(previewFigures([step('m1', 0)])).toBe('1 ejercicio')
  })

  test('an empty routine says so once and not twice', () => {
    // «0 ejercicios · 0 series» dice que está vacía dos veces.
    expect(previewFigures([])).toBe('Todavía sin ejercicios')
  })
})

describe('previewTitle', () => {
  test('a routine with no name still has something to draw', () => {
    expect(previewTitle('   ')).toBe('Sin nombre')
  })

  test('and one with a name is drawn trimmed', () => {
    expect(previewTitle('  Empuje  ')).toBe('Empuje')
  })
})

describe('dominantRegion', () => {
  const REGIONS: readonly MuscleTerm[] = [
    ...MUSCLES,
    { code: 'quads', name: 'Cuádriceps', region: 'lower', body_slug: 'quadriceps' },
    { code: 'glutes', name: 'Glúteos', region: 'lower', body_slug: 'gluteal' },
    { code: 'abs', name: 'Abdomen', region: 'general', body_slug: 'abs' },
  ]

  test('a leg routine crops the lower half, or the card shows an empty torso', () => {
    expect(dominantRegion(['quads', 'glutes'], REGIONS)).toBe('lower')
  })

  test('and a push routine the upper one', () => {
    expect(dominantRegion(['chest', 'triceps'], REGIONS)).toBe('upper')
  })

  test('a tie goes to the torso, which is where an undecided routine reads', () => {
    expect(dominantRegion(['chest', 'quads'], REGIONS)).toBe('upper')
  })

  test('general muscles do not tilt it either way: the belly is in both crops', () => {
    expect(dominantRegion(['abs'], REGIONS)).toBe('upper')
    expect(dominantRegion(['abs', 'quads'], REGIONS)).toBe('lower')
  })

  test('nothing worked yet still answers something drawable', () => {
    expect(dominantRegion([], REGIONS)).toBe('upper')
  })
})
