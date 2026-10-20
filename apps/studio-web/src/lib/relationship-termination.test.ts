import { describe, expect, test } from 'bun:test'

import {
  canTerminateRelationship,
  terminationReasonMessage,
  terminationReasonProblem,
  terminationRefusalDescription,
  terminationRefusalFor,
  terminationRefusalTitle,
  whatTerminationStops,
  whatTerminationStopsSentence,
} from './relationship-termination'
import type { RelationshipState } from './studio-api'

function relationship(overrides: Partial<RelationshipState> = {}): RelationshipState {
  return {
    relationship_id: 'r',
    person_id: 'p',
    status: 'active',
    holder: { membership_id: 'm', display_name: 'Camilo Restrepo' },
    substitutions: [],
    grants: [],
    ...overrides,
  } as unknown as RelationshipState
}

describe('quién puede terminar un vínculo', () => {
  /*
   * `OP-REL-008` rechaza a un coach de plano, incluso sobre un cliente que
   * atiende. Ofrecerle el botón gastaría un clic para llegar a una negativa.
   */
  test('el profesional responsable no puede, aunque sea su cliente', () => {
    expect(
      canTerminateRelationship({ mayAssignProfessionals: false, relationshipActive: true }),
    ).toBe(false)
  })

  test('quien puede asignar profesionales, sí', () => {
    expect(
      canTerminateRelationship({ mayAssignProfessionals: true, relationshipActive: true }),
    ).toBe(true)
  })

  test('un vínculo que ya terminó no se termina otra vez', () => {
    expect(
      canTerminateRelationship({ mayAssignProfessionals: true, relationshipActive: false }),
    ).toBe(false)
  })
})

describe('qué se para al terminar', () => {
  /*
   * Se cuenta antes de preguntar, no después de hacer: el diálogo tiene que
   * decirlo para que alguien decida, y para entonces el comando todavía no ha
   * contestado nada.
   */
  test('cuenta los permisos vigentes y a quien atiende', () => {
    const stopped = whatTerminationStops(
      relationship({
        grants: [{ status: 'active' }, { status: 'active' }, { status: 'revoked' }],
      } as unknown as Partial<RelationshipState>),
    )
    expect(stopped.grants).toBe(2)
    expect(stopped.professionals).toBe(1)
  })

  // Una suplencia corriendo también pierde el acceso, así que cuenta.
  test('suma la suplencia que está cubriendo', () => {
    const stopped = whatTerminationStops(
      relationship({
        substitutions: [{ status: 'active' }, { status: 'ended' }],
      } as unknown as Partial<RelationshipState>),
    )
    expect(stopped.professionals).toBe(2)
  })

  // Un permiso ya revocado no se para: ya estaba parado.
  test('no cuenta un permiso que ya estaba revocado', () => {
    const stopped = whatTerminationStops(
      relationship({ grants: [{ status: 'revoked' }] } as unknown as Partial<RelationshipState>),
    )
    expect(stopped.grants).toBe(0)
  })

  test('un vínculo que nadie atiende no para a ningún profesional', () => {
    const stopped = whatTerminationStops(
      relationship({ holder: null } as unknown as Partial<RelationshipState>),
    )
    expect(stopped.professionals).toBe(0)
  })
})

describe('la frase que cuenta lo que se para', () => {
  test('junta permisos y profesionales en una sola frase', () => {
    expect(
      whatTerminationStopsSentence(
        relationship({
          grants: [{ status: 'active' }, { status: 'active' }],
        } as unknown as Partial<RelationshipState>),
      ),
    ).toBe('Se cortan 2 permisos y 1 profesional deja de atenderla.')
  })

  // El singular tiene su propio verbo: «se cortan 1 permiso» no se lee.
  test('concuerda en singular', () => {
    expect(
      whatTerminationStopsSentence(
        relationship({ grants: [{ status: 'active' }] } as unknown as Partial<RelationshipState>),
      ),
    ).toBe('Se corta 1 permiso y 1 profesional deja de atenderla.')
  })

  test('omite la mitad que vale cero en vez de escribir un cero', () => {
    expect(whatTerminationStopsSentence(relationship())).toBe('1 profesional deja de atenderla.')
  })

  /*
   * Sin permisos vigentes y sin nadie atendiendo no se para nada, y la frase
   * desaparece: contestaría una pregunta que nadie hizo.
   */
  test('sin nada que parar no dice nada', () => {
    expect(
      whatTerminationStopsSentence(
        relationship({ holder: null } as unknown as Partial<RelationshipState>),
      ),
    ).toBeNull()
  })
})

describe('qué dice la pantalla cuando no se puede terminar', () => {
  test('un conflicto es que el vínculo ya no está activo', () => {
    expect(terminationRefusalFor(409)).toBe('already-ended')
    expect(terminationRefusalTitle('already-ended')).toContain('ya no está activo')
  })

  test('separa la negativa del fallo temporal', () => {
    expect(terminationRefusalFor(403)).toBe('not-allowed')
    expect(terminationRefusalFor(404)).toBe('gone')
    expect(terminationRefusalFor(undefined)).toBe('unavailable')
  })

  /*
   * El comando es todo o nada, así que un fallo temporal deja el vínculo
   * exactamente como estaba. Por eso este es el único que invita a reintentar,
   * y dice por qué es seguro.
   */
  test('ofrece reintentar solo donde no se escribió nada, y dice por qué', () => {
    expect(terminationRefusalDescription('unavailable')).toContain('otra vez')
    expect(terminationRefusalDescription('unavailable')).toContain('nadie perdió acceso')
    expect(terminationRefusalDescription('already-ended')).not.toContain('otra vez')
  })

  // La negativa explica que el responsable no puede, que es lo primero que
  // alguien se preguntaría al no encontrar el botón.
  test('la negativa explica que el responsable tampoco puede', () => {
    expect(terminationRefusalDescription('not-allowed')).toContain('profesional responsable')
  })
})

describe('el motivo', () => {
  // Opcional: el gimnasio no le debe una justificación al sistema.
  test('vacío está bien', () => {
    expect(terminationReasonProblem('')).toBeNull()
  })

  /*
   * Pero un motivo en blanco no es un motivo. Recortarlo en silencio le daría
   * la razón a quien cree que escribió uno.
   */
  test('en blanco no es un motivo', () => {
    expect(terminationReasonProblem('   ')).toBe('blank')
    expect(terminationReasonMessage('blank')).toContain('vacío')
  })

  test('uno escrito pasa', () => {
    expect(terminationReasonProblem('Se mudó de ciudad')).toBeNull()
  })

  test('uno larguísimo no', () => {
    expect(terminationReasonProblem('x'.repeat(2001))).toBe('too-long')
  })
})
