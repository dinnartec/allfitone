/**
 * Las frases de la biblioteca, que son donde vive el sentido de esta pantalla.
 *
 * La que importa es `whereUsed`: es el dato que el cliente no podía deducir y que la
 * base ahora responde, y decirlo mal —«En » sin nombre, o callar que una rutina está en
 * dos programas— es peor que no decirlo, porque el resto de la fila parece fiable.
 */

import { describe, expect, test } from 'bun:test'

import {
  dayName,
  discardWarning,
  emptyReason,
  filteredRoutines,
  programCaption,
  routineCounts,
  routineFigures,
  routineOfVersion,
  showsOlderVersion,
  whereUsed,
  type RoutineFilter,
} from './library'
import type { MyRoutine } from './content'
import type { MyProgram } from './programs'

function routine(overrides: Partial<MyRoutine> = {}): MyRoutine {
  return {
    template_id: 't1',
    title: 'Empuje',
    discipline_code: 'strength',
    status: 'published',
    template_version_id: 'v1',
    versions: ['v1'],
    cover: null,
    cover_url: null,
    muscles: [],
    muscle_sets: [],
    programs: [],
    exercise_count: 3,
    set_count: 13,
    has_unpublished_changes: false,
    ...overrides,
  }
}

function program(overrides: Partial<MyProgram> = {}): MyProgram {
  return {
    assignment_id: 'a1',
    program_version_id: 'pv1',
    program_id: 'p1',
    editable: true,
    title: 'Torso y pierna',
    weeks: 12,
    days_per_week: 2,
    starts_on: '2026-09-14',
    cover_url: null,
    routine_cover: null,
    sessions_done: 3,
    sessions_planned: 24,
    ...overrides,
  }
}

describe('whereUsed', () => {
  test('names the one programme a routine is in', () => {
    expect(
      whereUsed(routine({ programs: [{ program_id: 'p1', title: 'Fuerza básica' }] })),
    ).toEqual({ text: 'En Fuerza básica', loose: false })
  })

  test('joins two with «y», because two is not a list', () => {
    const both = routine({
      programs: [
        { program_id: 'p1', title: 'Fuerza básica' },
        { program_id: 'p2', title: 'Torso y pierna' },
      ],
    })
    expect(whereUsed(both).text).toBe('En Fuerza básica y Torso y pierna')
  })

  test('and three enumerate with commas and a final «y»', () => {
    const three = routine({
      programs: [
        { program_id: 'p1', title: 'A' },
        { program_id: 'p2', title: 'B' },
        { program_id: 'p3', title: 'C' },
      ],
    })
    expect(whereUsed(three).text).toBe('En A, B y C')
  })

  test('says so out loud when a routine is in none, rather than leaving a hole', () => {
    expect(whereUsed(routine())).toEqual({ text: 'Sin programa', loose: true })
  })
})

describe('programCaption', () => {
  test('a programme of your own says it is yours', () => {
    expect(programCaption(program())).toBe('Tuyo · 12 semanas · 2 días')
  })

  test('one taken from Allfit says where it came from, because it cannot be edited', () => {
    expect(programCaption(program({ editable: false, weeks: 8, days_per_week: 3 }))).toBe(
      'De Allfit · 8 semanas · 3 días',
    )
  })

  test('the one in progress adds which week it is on', () => {
    expect(programCaption(program({ editable: false, weeks: 8, days_per_week: 3 }), 1)).toBe(
      'De Allfit · 8 semanas · 3 días · semana 1 de 8',
    )
  })
})

describe('dayName', () => {
  test('names the day the programme assigned, counting Monday as one', () => {
    expect(dayName(1)).toBe('Lun')
    expect(dayName(7)).toBe('Dom')
  })

  test('and answers nothing for a number that is not a day of the week', () => {
    // Defensa contra un dato roto, no contra un caso del producto: el check de la base
    // ya lo impide, y la fila prefiere quedarse sin día a pintar «undefined».
    expect(dayName(0)).toBe('')
    expect(dayName(9)).toBe('')
  })
})

describe('routineFigures', () => {
  test('counts in plural', () => {
    expect(routineFigures(routine())).toBe('3 ejercicios · 13 series')
  })

  test('and in singular, because «1 ejercicios» is how a screen admits nobody read it', () => {
    expect(routineFigures(routine({ exercise_count: 1, set_count: 1 }))).toBe(
      '1 ejercicio · 1 serie',
    )
  })

  test('says nothing about series when there are none, rather than «· 0 series»', () => {
    // Una sesión de carrera no tiene series, y el cero parece un error en vez de un dato.
    expect(routineFigures(routine({ set_count: 0 }))).toBe('3 ejercicios')
  })
})

describe('filteredRoutines', () => {
  const loose = routine({ template_id: 'loose' })
  const used = routine({ template_id: 'used', programs: [{ program_id: 'p1', title: 'F' }] })
  const all = [loose, used]

  test.each([
    ['todas', ['loose', 'used']],
    ['en-programa', ['used']],
    ['sueltas', ['loose']],
  ] as Array<[RoutineFilter, string[]]>)('%s', (filter, expected) => {
    expect(filteredRoutines(all, filter).map((one) => one.template_id)).toEqual(expected)
  })

  test('counts every tab from the whole list, never from the open one', () => {
    expect(routineCounts(all)).toEqual({ todas: 2, 'en-programa': 1, sueltas: 1 })
  })
})

describe('emptyReason', () => {
  test('names what is missing, plainly', () => {
    expect(emptyReason('todas')).toBe('No hay rutinas aún')
    expect(emptyReason('en-programa')).toBe('No hay rutinas en programas aún')
  })

  test('and drops the «aún» where nothing is pending', () => {
    // No tener rutinas sueltas no es algo por hacer: es que todas están colocadas.
    expect(emptyReason('sueltas')).toBe('No hay rutinas sueltas')
  })
})

describe('discardWarning', () => {
  test('says the programme republishes, because that is a change nobody is looking at', () => {
    const used = routine({ programs: [{ program_id: 'p1', title: 'Fuerza básica' }] })
    expect(discardWarning(used)).toBe(
      'Se va de tu biblioteca y de Fuerza básica, que se republica sin ella.',
    )
  })

  test('counts them when there are several, instead of listing a paragraph', () => {
    const used = routine({
      programs: [
        { program_id: 'p1', title: 'A' },
        { program_id: 'p2', title: 'B' },
      ],
    })
    expect(discardWarning(used)).toContain('2 programas')
  })

  test('and one in no programme only promises what it can', () => {
    expect(discardWarning(routine())).toContain('Lo ya entrenado se conserva')
  })
})

describe('routineOfVersion', () => {
  const empuje = routine({
    template_id: 'empuje',
    template_version_id: 'v6',
    versions: ['v6', 'v5', 'v4'],
  })

  test('finds the routine a week composed, even after it was republished', () => {
    // El defecto que esto arregla: la semana guarda v5, la rutina ya va por v6, y buscar
    // por «última versión» la perdía — el día se veía vacío en un programa donde está.
    expect(routineOfVersion([empuje], 'v5')?.template_id).toBe('empuje')
  })

  test('and still finds it by its newest', () => {
    expect(routineOfVersion([empuje], 'v6')?.template_id).toBe('empuje')
  })

  test('an empty day resolves to nothing rather than to the first routine', () => {
    expect(routineOfVersion([empuje], null)).toBeUndefined()
  })

  test('and a version of something else is nothing, not a near miss', () => {
    expect(routineOfVersion([empuje], 'v9')).toBeUndefined()
  })

  test('says when the day is holding a version that is no longer the newest', () => {
    expect(showsOlderVersion(empuje, 'v5')).toBe(true)
    expect(showsOlderVersion(empuje, 'v6')).toBe(false)
  })
})
