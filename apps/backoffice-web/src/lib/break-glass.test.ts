import { describe, expect, test } from 'bun:test'

import {
  BREAK_GLASS_CATEGORIES,
  approvalsSoFar,
  breakGlassMessage,
  canDecide,
  canExercise,
  categoryLabel,
  emptyReadMessage,
  formatDay,
  healthContextRows,
  mealRows,
  trainingRows,
  measurementRows,
  outcomeMessage,
  projectedTier,
  purposeLabel,
  quorumSentence,
  requestIssue,
  requestIssueMessage,
  resourceTypeFor,
  statusLabel,
  statusTone,
  tierConsequence,
  windowSentence,
  type BreakGlassCategory,
  type BreakGlassExerciseOutcome,
  type BreakGlassRequest,
} from './break-glass'

function file(overrides: Partial<BreakGlassRequest> = {}): BreakGlassRequest {
  return {
    id: '019a8000-0000-7000-8000-000000000401',
    requester_person_id: '019a8000-0000-7000-8000-000000000003',
    subject_person_id: '019a8000-0000-7000-8000-000000000006',
    categories: ['nutrition_guidance'],
    purpose: 'customer_support_request',
    case_reference: 'CASE-2026-001',
    sensitivity_tier: 'standard',
    required_approvals: 1,
    requested_duration_minutes: 30,
    requested_at: '2026-09-10T18:00:00.000Z',
    request_expires_at: '2026-09-10T18:30:00.000Z',
    status: 'requested',
    window_starts_at: null,
    window_ends_at: null,
    closed_at: null,
    reviewed_at: null,
    review_outcome: null,
    approvals: [],
    exercise_count: 0,
    viewer_is_requester: false,
    viewer_can_decide: false,
    viewer_can_exercise: false,
    ...overrides,
  }
}

describe('break-glass presentation rules', () => {
  test('offers only the approvable categories', () => {
    expect(BREAK_GLASS_CATEGORIES).toHaveLength(6)
    // The forbidden set is absent rather than disabled: an option that can never
    // be granted is an invitation to try.
    for (const forbidden of ['nutrition_media', 'payments', 'identity']) {
      expect(BREAK_GLASS_CATEGORIES as readonly string[]).not.toContain(forbidden)
    }
    const labels = BREAK_GLASS_CATEGORIES.map((category) => categoryLabel(category))
    expect(new Set(labels).size).toBe(BREAK_GLASS_CATEGORIES.length)
  })

  test('names the five closed purposes and nothing else', () => {
    expect(purposeLabel('security_investigation')).toBe('Investigación de seguridad')
    expect(purposeLabel('customer_support_request')).toBe('La persona pidió soporte')
  })

  test('derives the tier from the scope the same way the server does', () => {
    expect(projectedTier([])).toBeNull()
    expect(projectedTier(['nutrition_guidance'])).toBe('standard')
    expect(projectedTier(['nutrition_intake'])).toBe('restricted')
    expect(projectedTier(['health_context'])).toBe('restricted')
    // A mixed scope inherits the stricter tier rather than averaging.
    expect(projectedTier(['nutrition_guidance', 'nutrition_intake'])).toBe('restricted')
  })

  test('states the tier as a consequence, with its cost spelled out', () => {
    const standard = tierConsequence(['nutrition_guidance'])
    expect(standard?.approvals).toBe(1)
    expect(standard?.minutes).toBe(30)
    expect(standard?.sentence).toContain('una aprobación')

    const restricted = tierConsequence(['health_context'])
    expect(restricted?.approvals).toBe(2)
    expect(restricted?.minutes).toBe(15)
    expect(restricted?.sentence).toContain('dos personas distintas')
  })

  test('refuses a request with no subject, no case or no scope', () => {
    const draft = {
      subject: '019a8000-0000-7000-8000-000000000006',
      caseReference: 'CASE-2026-001',
      categories: ['nutrition_guidance'] as BreakGlassCategory[],
    }
    expect(requestIssue(draft)).toBeUndefined()
    expect(requestIssue({ ...draft, subject: 'nobody' })).toBe('subject')
    expect(requestIssue({ ...draft, caseReference: 'porque sí' })).toBe('case')
    expect(requestIssue({ ...draft, categories: [] })).toBe('categories')
    // There is no scope for "the whole account", and the message says so.
    expect(requestIssueMessage('categories')).toContain('toda la cuenta')
  })

  test('says how much of the window is left, and that it cannot be extended', () => {
    const now = Date.parse('2026-09-10T18:10:00.000Z')
    const open = file({
      status: 'approved',
      window_starts_at: '2026-09-10T18:00:00.000Z',
      window_ends_at: '2026-09-10T18:15:00.000Z',
    })
    expect(windowSentence(open, now)).toContain('5 minutos')
    expect(windowSentence(open, now)).toContain('No se puede extender')

    const lapsed = file({
      status: 'approved',
      window_starts_at: '2026-09-10T17:00:00.000Z',
      window_ends_at: '2026-09-10T17:15:00.000Z',
    })
    expect(windowSentence(lapsed, now)).toContain('ya venció')

    // A pending request has no window to describe.
    expect(windowSentence(file(), now)).toBeNull()
  })

  test('says how far a pending request is from opening', () => {
    expect(quorumSentence(file({ required_approvals: 2 }))).toContain('Faltan 2')
    expect(
      quorumSentence(
        file({
          required_approvals: 2,
          approvals: [
            {
              approver_person_id: 'a',
              decision: 'approved',
              reason_code: 'REASON-OK',
              decided_at: '2026-09-10T18:01:00.000Z',
            },
          ],
        }),
      ),
    ).toContain('Faltan 1')
    expect(approvalsSoFar(file())).toBe(0)
  })

  test('takes the permission hints from the server rather than re-deriving them', () => {
    expect(canDecide(file({ viewer_can_decide: true }))).toBe(true)
    expect(canDecide(file({ viewer_can_decide: false }))).toBe(false)
    expect(canExercise(file({ viewer_can_exercise: true }))).toBe(true)
    expect(canExercise(file({ viewer_can_exercise: false }))).toBe(false)
  })

  test('stops offering a read the moment the window runs out', () => {
    const open = file({
      status: 'approved',
      viewer_can_exercise: true,
      window_starts_at: '2026-09-10T18:00:00.000Z',
      window_ends_at: '2026-09-10T18:15:00.000Z',
    })

    expect(canExercise(open, Date.parse('2026-09-10T18:14:59.000Z'))).toBe(true)
    // The hint was true when the server answered it. A lapsed window delivers
    // nothing, so the screen withdraws the read without waiting for a refetch.
    expect(canExercise(open, Date.parse('2026-09-10T18:15:00.000Z'))).toBe(false)
    expect(canExercise(open, Date.parse('2026-09-10T19:00:00.000Z'))).toBe(false)
  })

  test('tells an open window apart from every terminal state', () => {
    expect(statusTone('approved')).toBe('success')
    expect(statusTone('requested')).toBe('warning')
    expect(statusTone('rejected')).toBe('destructive')
    expect(statusTone('closed')).toBe('secondary')
    expect(statusLabel('approved')).toBe('Ventana abierta')
    expect(statusLabel('requested')).toBe('Esperando aprobación')
  })

  test('explains every outcome, including the authorised one', () => {
    const base = {
      break_glass_event_id: '019a8000-0000-7000-8000-000000000601',
      occurred_at: '2026-09-10T18:05:00.000Z',
    }
    expect(
      outcomeMessage({ ...base, outcome: 'denied', reason_code: 'not_the_requester' }),
    ).toContain('Sólo quien pidió')
    expect(
      outcomeMessage({ ...base, outcome: 'denied', reason_code: 'category_out_of_scope' }),
    ).toContain('alcance aprobado')
    // The authorised-but-empty case has to be explained too: an operator who reads
    // "no content" without context will assume the window failed.
    const unavailable = outcomeMessage({
      ...base,
      outcome: 'content_unavailable',
      reason_code: 'category_content_absent',
    })
    expect(unavailable).toContain('válida')
    expect(unavailable).toContain('registrado')
    expect(
      outcomeMessage({ ...base, outcome: 'allowed', reason_code: 'authorized_exercise' }),
    ).toContain('autorizada')
    expect(
      outcomeMessage({ ...base, outcome: 'denied', reason_code: 'resource_out_of_scope' }),
    ).toContain('no corresponde a la categoría')
  })

  test('names the table each category reads, so the evidence says what was opened', () => {
    expect(resourceTypeFor('body_progress')).toBe('identity.body_progress_records')
    expect(resourceTypeFor('health_context')).toBe('identity.health_context_claims')
    expect(resourceTypeFor('nutrition_intake')).toBe('nutrition.meals')
    expect(resourceTypeFor('nutrition_guidance')).toBe('nutrition.goal_versions')
    expect(resourceTypeFor('relationship_training')).toBe('execution.executed_sessions')
    expect(resourceTypeFor('prior_training_history')).toBe('execution.executed_sessions')
    for (const category of BREAK_GLASS_CATEGORIES) {
      expect(resourceTypeFor(category)).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
    }
  })

  test('shows a measurement as the person recorded it and as it was normalized', () => {
    const allowed: BreakGlassExerciseOutcome = {
      outcome: 'allowed',
      reason_code: 'authorized_exercise',
      break_glass_event_id: '019a8000-0000-7000-8000-000000000603',
      occurred_at: '2026-09-10T18:07:00.000Z',
      category: 'body_progress',
      content: {
        body_progress: [
          {
            id: '019a8000-0000-7000-8000-000000000701',
            metric_code: 'waist',
            value: 0.82,
            unit_code: 'm',
            original_value: 82,
            original_unit_code: 'cm',
            measured_on: '2026-09-01',
            has_media: false,
            recorded_at: '2026-09-01T11:00:00.000Z',
          },
          {
            id: '019a8000-0000-7000-8000-000000000702',
            metric_code: 'body_fat',
            value: 18.5,
            unit_code: 'percent',
            original_value: null,
            original_unit_code: null,
            measured_on: '2026-08-31',
            has_media: true,
            recorded_at: '2026-08-31T11:00:00.000Z',
          },
        ],
      },
    }

    // A date without a time is the day the person measured, in any time zone: read
    // as UTC midnight and shown in Bogotá it would move to the day before.
    expect(measurementRows(allowed)).toEqual([
      {
        id: '019a8000-0000-7000-8000-000000000701',
        metric: 'Cintura',
        recorded: '82 cm',
        normalized: '0,82 m',
        measuredOn: '1 de septiembre de 2026',
        photo: 'Sin foto',
      },
      {
        id: '019a8000-0000-7000-8000-000000000702',
        metric: 'Grasa corporal',
        recorded: '18,5 %',
        normalized: '18,5 %',
        measuredOn: '31 de agosto de 2026',
        photo: 'Tiene foto; no se muestra aquí',
      },
    ])
    const { content: _content, ...withoutContent } = allowed
    expect(measurementRows({ ...withoutContent, outcome: 'content_unavailable' })).toEqual([])
    expect(measurementRows({ ...allowed, outcome: 'denied' })).toEqual([])
  })

  test('shows a health claim as declared, with where it came from', () => {
    const allowed: BreakGlassExerciseOutcome = {
      outcome: 'allowed',
      reason_code: 'authorized_exercise',
      break_glass_event_id: '019a8000-0000-7000-8000-000000000604',
      occurred_at: '2026-09-10T18:08:00.000Z',
      category: 'health_context',
      content: {
        health_context: [
          {
            id: '019a8000-0000-7000-8000-000000000801',
            context_type: 'limitation',
            description: 'No puedo levantar los brazos por encima de la cabeza',
            body_area: 'shoulder',
            provenance: 'person_declared',
            valid_from: '2026-09-01T10:00:00.000Z',
            valid_to: null,
            recorded_at: '2026-09-01T10:05:00.000Z',
          },
          {
            id: '019a8000-0000-7000-8000-000000000802',
            context_type: 'recovery',
            description: 'Recuperación de esguince',
            body_area: null,
            provenance: 'professional_observation',
            valid_from: '2026-08-20T10:00:00.000Z',
            valid_to: '2026-10-01T10:00:00.000Z',
            recorded_at: '2026-08-20T10:05:00.000Z',
          },
        ],
      },
    }

    expect(healthContextRows(allowed)).toEqual([
      {
        id: '019a8000-0000-7000-8000-000000000801',
        type: 'Limitación',
        description: 'No puedo levantar los brazos por encima de la cabeza',
        area: 'Hombro',
        since: formatDay('2026-09-01T10:00:00.000Z'),
        until: 'Sin fecha de fin',
        provenance: 'Lo declaró la persona',
      },
      {
        id: '019a8000-0000-7000-8000-000000000802',
        type: 'Recuperación',
        description: 'Recuperación de esguince',
        area: 'Sin zona indicada',
        since: formatDay('2026-08-20T10:00:00.000Z'),
        until: formatDay('2026-10-01T10:00:00.000Z'),
        provenance: 'Lo observó un profesional',
      },
    ])
    expect(healthContextRows({ ...allowed, outcome: 'denied' })).toEqual([])
    // A body read carries no claims, and a claim is never read as a measurement.
    expect(healthContextRows({ ...allowed, content: { body_progress: [] } })).toEqual([])
    expect(measurementRows(allowed)).toEqual([])
  })

  test('shows a meal when and where it was eaten, what it had and what it added up to', () => {
    const allowed: BreakGlassExerciseOutcome = {
      outcome: 'allowed',
      reason_code: 'authorized_exercise',
      break_glass_event_id: '019a8000-0000-7000-8000-000000000605',
      occurred_at: '2026-09-10T18:09:00.000Z',
      category: 'nutrition_intake',
      content: {
        nutrition_intake: [
          {
            id: '019a8000-0000-7000-8000-000000000901',
            occurred_at: '2026-09-15T23:30:00+00:00',
            local_date: '2026-09-15',
            timezone: 'America/Bogota',
            meal_type: 'dinner',
            note: 'Con poca sal',
            revision_number: 0,
            has_media: true,
            items: [
              // Out of order on purpose: the row lists items by position.
              {
                position: 2,
                name: 'Arroz',
                quantity: 150,
                quantity_unit: 'g',
                nutrients: [
                  { nutrient_code: 'carbohydrates', value: 42, unit: 'g' },
                  { nutrient_code: 'energy', value: 195, unit: 'kcal' },
                ],
              },
              {
                position: 1,
                name: 'Pollo a la plancha',
                quantity: 120,
                quantity_unit: 'g',
                nutrients: [
                  { nutrient_code: 'energy', value: 198, unit: 'kcal' },
                  { nutrient_code: 'protein', value: 37.5, unit: 'g' },
                ],
              },
              { position: 3, name: 'Ensalada', quantity: null, quantity_unit: null, nutrients: [] },
            ],
          },
          {
            id: '019a8000-0000-7000-8000-000000000902',
            occurred_at: '2026-09-15T12:00:00+00:00',
            local_date: '2026-09-15',
            timezone: 'Europe/Madrid',
            meal_type: 'snack',
            note: null,
            revision_number: 0,
            has_media: false,
            items: [
              { position: 1, name: 'Té', quantity: null, quantity_unit: null, nutrients: [] },
            ],
          },
        ],
      },
    }

    const [dinner, snack] = mealRows(allowed)
    // The hour in the meal's own zone: 23:30 UTC is 18:30 in Bogotá, and 12:00 is 14:00 in Madrid.
    expect(dinner?.when).toContain('6:30')
    expect(dinner?.when).toContain('America/Bogota')
    expect(snack?.when).toContain('2:00')
    expect(snack?.when).toContain('Europe/Madrid')
    expect(dinner).toMatchObject({
      id: '019a8000-0000-7000-8000-000000000901',
      type: 'Cena',
      eaten: 'Pollo a la plancha, 120 g · Arroz, 150 g · Ensalada',
      totals: '393 kcal · 37,5 g de proteína · 42 g de carbohidratos',
      note: 'Con poca sal',
      photo: 'Tiene foto; no se muestra aquí',
    })
    expect(snack).toMatchObject({
      type: 'Merienda',
      eaten: 'Té',
      totals: 'Sin valores registrados',
      note: 'Sin nota',
      photo: 'Sin foto',
    })
    // A zone the browser does not know still shows a moment instead of breaking the screen.
    const snackMeal = allowed.content?.nutrition_intake?.[1]
    if (!snackMeal) throw new Error('the fixture has a second meal')
    const [unknownZone] = mealRows({
      ...allowed,
      content: { nutrition_intake: [{ ...snackMeal, timezone: 'Mars/Olympus_Mons' }] },
    })
    expect(unknownZone?.when).toContain('2026')
    expect(unknownZone?.when).toContain('Mars/Olympus_Mons')
    expect(mealRows({ ...allowed, outcome: 'denied' })).toEqual([])
    expect(measurementRows(allowed)).toEqual([])
    expect(healthContextRows(allowed)).toEqual([])
  })

  test('shows a session as when it was trained, how long it lasted and what it held', () => {
    const allowed: BreakGlassExerciseOutcome = {
      outcome: 'allowed',
      reason_code: 'authorized_exercise',
      break_glass_event_id: '019a8000-0000-7000-8000-000000000606',
      occurred_at: '2026-09-10T18:11:00.000Z',
      category: 'prior_training_history',
      content: {
        prior_training_history: [
          {
            id: '019a8000-0000-7000-8000-000000000a01',
            activity_type_code: 'test_strength_session',
            activity_type_name: 'Sesión de fuerza',
            discipline_code: 'test_strength',
            started_at: '2026-09-15T12:00:00+00:00',
            ended_at: '2026-09-15T13:15:00+00:00',
            timezone: 'America/Bogota',
            status: 'completed',
            validation_status: 'pending',
            requested_level: 'detailed',
            achieved_level: null,
            revision_number: 3,
            capture_source: 'manual',
            contract: { id: '019c0000-0000-7000-8000-000000000031', version: 1 },
            segments: [{ position: 1, activity_type_code: 'test_strength_session' }],
            strength_sets: [
              {
                segment_position: 1,
                order: 1,
                movement_id: null,
                movement_name: 'Sentadilla',
                achieved_reps: 8,
                load: { value: 80, unit: 'kg' },
                rpe: 7,
              },
              {
                segment_position: 1,
                order: 2,
                movement_id: null,
                movement_name: 'Sentadilla',
                achieved_reps: 6,
                load: { value: 85, unit: 'kg' },
                rpe: 8,
              },
            ],
            endurance_laps: [],
          },
          {
            id: '019a8000-0000-7000-8000-000000000a02',
            activity_type_code: 'test_endurance_session',
            activity_type_name: 'Sesión de resistencia',
            discipline_code: 'test_endurance',
            started_at: '2026-09-14T11:00:00+00:00',
            ended_at: null,
            timezone: 'Europe/Madrid',
            status: 'in_progress',
            validation_status: 'pending',
            requested_level: 'summary',
            achieved_level: null,
            revision_number: 1,
            capture_source: 'device',
            contract: { id: '019c0000-0000-7000-8000-000000000032', version: 2 },
            segments: [{ position: 1, activity_type_code: 'test_endurance_session' }],
            strength_sets: [],
            endurance_laps: [
              {
                segment_position: 1,
                lap_number: 1,
                distance: { value: 1, unit: 'km' },
                duration_seconds: 330,
              },
              {
                segment_position: 1,
                lap_number: 2,
                distance: { value: 1, unit: 'km' },
                duration_seconds: 275,
              },
            ],
          },
        ],
      },
    }

    const [strength, run] = trainingRows(allowed)
    // The hour in the session's own zone: 12:00 UTC is 7:00 in Bogotá, and 11:00 is 13:00 in Madrid.
    expect(strength?.when).toContain('7:00')
    expect(strength?.when).toContain('America/Bogota')
    expect(run?.when).toContain('1:00')
    expect(run?.when).toContain('Europe/Madrid')
    expect(strength).toMatchObject({
      id: '019a8000-0000-7000-8000-000000000a01',
      activity: 'Sesión de fuerza',
      duration: '1 h 15 min',
      done: '2 series · 14 repeticiones · hasta 85 kg',
      state: 'Completada · sin validar',
      level: 'Sin nivel certificado',
    })
    expect(run).toMatchObject({
      activity: 'Sesión de resistencia',
      duration: 'Sin cerrar',
      done: '2 tramos · 2 km · 10:05',
      state: 'En curso · sin validar',
    })
    const empty = allowed.content?.prior_training_history?.[0]
    if (!empty) throw new Error('the fixture has a first session')
    const [nothing] = trainingRows({
      ...allowed,
      content: { prior_training_history: [{ ...empty, strength_sets: [], endurance_laps: [] }] },
    })
    expect(nothing?.done).toBe('Sin resultados registrados')
    // Kilos and pounds are never added together; each unit keeps its own top.
    const [mixed] = trainingRows({
      ...allowed,
      content: {
        prior_training_history: [
          {
            ...empty,
            strength_sets: [
              ...empty.strength_sets,
              {
                segment_position: 1,
                order: 3,
                movement_id: null,
                movement_name: 'Peso muerto',
                achieved_reps: 5,
                load: { value: 40, unit: 'lb' },
                rpe: 8,
              },
            ],
          },
        ],
      },
    })
    expect(mixed?.done).toContain('hasta 85 kg y 40 lb')
    expect(trainingRows({ ...allowed, outcome: 'denied' })).toEqual([])
    expect(measurementRows(allowed)).toEqual([])
    expect(mealRows(allowed)).toEqual([])
  })

  test('dates a claim by its day, which is all a declaration knows', () => {
    expect(formatDay('2026-09-01T10:00:00.000Z')).not.toMatch(/d:dd/)
    expect(formatDay('2026-09-01T10:00:00.000Z')).toContain('2026')
    expect(formatDay('not a date')).toBe('—')
  })

  test('says what an empty authorised read means for the category it read', () => {
    expect(emptyReadMessage('body_progress')).toBe('La persona no tiene mediciones registradas.')
    expect(emptyReadMessage('health_context')).toBe(
      'La persona no ha declarado dolores, limitaciones ni recuperaciones.',
    )
    expect(emptyReadMessage('nutrition_intake')).toBe('La persona no ha registrado comidas.')
    expect(emptyReadMessage('prior_training_history')).toBe(
      'La persona no tiene sesiones de entrenamiento registradas.',
    )
    expect(emptyReadMessage('nutrition_guidance')).toBe('La lectura no devolvió registros.')
    expect(emptyReadMessage(undefined)).toBe('La lectura no devolvió registros.')
  })

  test('answers the state machine with the next action, never a retry', () => {
    expect(breakGlassMessage('conflict')).toContain('pide otra')
    expect(breakGlassMessage('conflict')).toContain('no se reabre')
    expect(breakGlassMessage('forbidden')).toContain('vencen por diseño')
    expect(breakGlassMessage('anything-else')).toBe('No se pudo completar la operación.')
  })
})
