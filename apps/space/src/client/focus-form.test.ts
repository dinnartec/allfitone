import { describe, expect, test } from 'bun:test'

import {
  allZoneSlugs,
  areasFor,
  BODY_BASE_HEIGHT,
  bodyGender,
  bodyScale,
  canSubmitFocus,
  FOCUS_ZONES,
  focusHint,
  focusSummary,
  INERT_SLUGS,
  isAnswered,
  litSlugs,
  NOTHING_CHOSEN,
  selectionFromAreas,
  slugsForZone,
  toggleFocus,
  zoneForSlug,
  WHOLE_BODY,
  type BodySlug,
  type FocusSelection,
  type FocusZone,
} from './focus-form'

/** Exactly what the library ships, read from its own assets. */
const AVAILABLE: Record<'front' | 'back', readonly BodySlug[]> = {
  front: [
    'abs',
    'adductors',
    'ankles',
    'biceps',
    'calves',
    'chest',
    'deltoids',
    'feet',
    'forearm',
    'hair',
    'hands',
    'head',
    'knees',
    'neck',
    'obliques',
    'quadriceps',
    'tibialis',
    'trapezius',
    'triceps',
  ],
  back: [
    'adductors',
    'ankles',
    'calves',
    'deltoids',
    'feet',
    'forearm',
    'gluteal',
    'hair',
    'hamstring',
    'hands',
    'head',
    'lower-back',
    'neck',
    'trapezius',
    'triceps',
    'upper-back',
  ],
}

const all = (): FocusZone[] => FOCUS_ZONES.map((entry) => entry.zone)

describe('FOCUS_ZONES', () => {
  test('offers the seven zones the story names', () => {
    expect(FOCUS_ZONES).toHaveLength(7)
  })

  test('every muscle it maps to actually exists in the library', () => {
    // The mapping is the one place a typo would light nothing and report nothing,
    // so it is checked against the parts the package really ships.
    for (const entry of FOCUS_ZONES) {
      for (const slug of entry.front) expect(AVAILABLE.front).toContain(slug)
      for (const slug of entry.back) expect(AVAILABLE.back).toContain(slug)
    }
  })

  test('no zone is empty on both faces, which would make an untouchable chip', () => {
    for (const entry of FOCUS_ZONES) {
      expect(entry.front.length + entry.back.length).toBeGreaterThan(0)
    }
  })

  test('never maps a zone onto something inert', () => {
    for (const entry of FOCUS_ZONES) {
      for (const slug of [...entry.front, ...entry.back]) {
        expect(INERT_SLUGS).not.toContain(slug)
      }
    }
  })

  test('calls the middle zone abdomen, not core', () => {
    const middle = FOCUS_ZONES.find((entry) => entry.zone === 'abs')

    expect(middle?.name).toBe('Abdomen')
  })
})

describe('slugsForZone', () => {
  test('answers the muscles of that zone on that face only', () => {
    expect(slugsForZone('abs', 'front')).toEqual(['abs', 'obliques'])
    expect(slugsForZone('abs', 'back')).toEqual([])
  })

  test('answers nothing for a zone that does not exist rather than throwing', () => {
    expect(slugsForZone('nope' as never, 'front')).toEqual([])
  })
})

describe('toggleFocus', () => {
  test('adds and removes a zone', () => {
    const one = toggleFocus(NOTHING_CHOSEN, 'chest')
    expect(one.zones).toEqual(['chest'])

    const none = toggleFocus(one, 'chest')
    expect(none.zones).toEqual([])
  })

  test('keeps the declared order however they are marked', () => {
    // Otherwise the chips would reorder themselves as the person taps.
    const picked = toggleFocus(toggleFocus(NOTHING_CHOSEN, 'legs'), 'chest')

    expect(picked.zones).toEqual(['chest', 'legs'])
  })

  test('choosing whole body clears the zones', () => {
    const zones = toggleFocus(toggleFocus(NOTHING_CHOSEN, 'chest'), 'arms')
    const whole = toggleFocus(zones, WHOLE_BODY)

    expect(whole).toEqual({ zones: [], whole: true })
  })

  test('choosing a zone turns whole body off', () => {
    const whole = toggleFocus(NOTHING_CHOSEN, WHOLE_BODY)
    const zone = toggleFocus(whole, 'glutes')

    expect(zone).toEqual({ zones: ['glutes'], whole: false })
  })

  test('whole body toggles back off to nothing chosen', () => {
    const whole = toggleFocus(NOTHING_CHOSEN, WHOLE_BODY)

    expect(toggleFocus(whole, WHOLE_BODY)).toEqual(NOTHING_CHOSEN)
  })

  test('the seventh zone folds into whole body instead of drawing the same thing twice', () => {
    // Seven marks and whole body draw an identical figure and mean the opposite:
    // "emphasise everything" against "no emphasis, my goal decides".
    const everything = all().reduce(toggleFocus, NOTHING_CHOSEN as FocusSelection)

    expect(everything).toEqual({ zones: [], whole: true })
  })

  test('six zones do not fold, so the collapse is only at the boundary', () => {
    const six = all()
      .slice(0, 6)
      .reduce(toggleFocus, NOTHING_CHOSEN as FocusSelection)

    expect(six.whole).toBe(false)
    expect(six.zones).toHaveLength(6)
  })
})

describe('litSlugs', () => {
  test('lights what the chosen zones map to on that face', () => {
    const arms = toggleFocus(NOTHING_CHOSEN, 'arms')

    expect(litSlugs(arms, 'front')).toEqual(['biceps', 'triceps', 'forearm'])
    expect(litSlugs(arms, 'back')).toEqual(['triceps', 'forearm'])
  })

  test('lights nothing on a face where the zone has no muscles', () => {
    const chest = toggleFocus(NOTHING_CHOSEN, 'chest')

    expect(litSlugs(chest, 'back')).toEqual([])
  })

  test('does not repeat a muscle two zones share', () => {
    // Trapezius belongs to the back zone on both faces; forearm to arms on both.
    const both = toggleFocus(toggleFocus(NOTHING_CHOSEN, 'back'), 'arms')
    const front = litSlugs(both, 'front')

    expect(new Set(front).size).toBe(front.length)
  })

  test('whole body lights every mapped muscle and nothing inert', () => {
    const whole = toggleFocus(NOTHING_CHOSEN, WHOLE_BODY)

    for (const side of ['front', 'back'] as const) {
      const lit = litSlugs(whole, side)
      expect(lit.length).toBeGreaterThan(0)
      for (const slug of INERT_SLUGS) expect(lit).not.toContain(slug)
    }
  })

  test('nothing chosen lights nothing', () => {
    expect(litSlugs(NOTHING_CHOSEN, 'front')).toEqual([])
    expect(litSlugs(NOTHING_CHOSEN, 'back')).toEqual([])
  })
})

describe('zoneForSlug', () => {
  test('maps a muscle back to the zone that owns it, so a tap on the figure equals a tap on the chip', () => {
    expect(zoneForSlug('quadriceps', 'front')).toBe('legs')
    expect(zoneForSlug('gluteal', 'back')).toBe('glutes')
    expect(zoneForSlug('obliques', 'front')).toBe('abs')
  })

  test('answers nothing for the head, hands and feet, which must not react to a tap', () => {
    for (const slug of INERT_SLUGS) {
      expect(zoneForSlug(slug, 'front')).toBeUndefined()
      expect(zoneForSlug(slug, 'back')).toBeUndefined()
    }
  })

  test('reads the same muscle differently per face where the mapping differs', () => {
    // Trapezius is the back zone on both faces, but only the back face carries
    // upper and lower back with it.
    expect(zoneForSlug('trapezius', 'front')).toBe('back')
    expect(zoneForSlug('upper-back', 'back')).toBe('back')
  })
})

describe('bodyGender', () => {
  test('brings the woman only when female was declared', () => {
    expect(bodyGender('female')).toBe('female')
    expect(bodyGender('male')).toBe('male')
  })

  test('brings the man when the question was declined', () => {
    expect(bodyGender(null)).toBe('male')
  })
})

describe('bodyScale', () => {
  test('derives the scale from the library fixed render height', () => {
    expect(bodyScale(BODY_BASE_HEIGHT)).toBe(1)
    expect(bodyScale(BODY_BASE_HEIGHT / 2)).toBe(0.5)
  })

  test('answers zero rather than a negative scale on a box with no room', () => {
    expect(bodyScale(0)).toBe(0)
    expect(bodyScale(-40)).toBe(0)
  })
})

describe('isAnswered', () => {
  test('whole body is an answer even though it leaves no zones', () => {
    // Without this the screen would ask again on every cold start, which is the
    // same trap the declined sex had.
    expect(isAnswered({ zones: [], whole: true })).toBe(true)
  })

  test('a marked zone is an answer', () => {
    expect(isAnswered({ zones: ['chest'], whole: false })).toBe(true)
  })

  test('nothing chosen is not an answer yet', () => {
    expect(isAnswered(NOTHING_CHOSEN)).toBe(false)
  })
})

describe('canSubmitFocus', () => {
  const chosen: FocusSelection = { zones: ['chest'], whole: false }

  test('refuses until something is answered', () => {
    // Departs from criterion 3, which allows pointing at none. The story needs
    // amending; this test is what stops the two drifting apart silently.
    expect(
      canSubmitFocus({ selection: NOTHING_CHOSEN, submitting: false, sessionExpired: false }),
    ).toBe(false)
  })

  test('takes whole body as an answer, which is how someone says no emphasis', () => {
    expect(
      canSubmitFocus({
        selection: { zones: [], whole: true },
        submitting: false,
        sessionExpired: false,
      }),
    ).toBe(true)
  })

  test('allows a marked zone', () => {
    expect(canSubmitFocus({ selection: chosen, submitting: false, sessionExpired: false })).toBe(
      true,
    )
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitFocus({ selection: chosen, submitting: true, sessionExpired: false })).toBe(
      false,
    )
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitFocus({ selection: chosen, submitting: false, sessionExpired: true })).toBe(
      false,
    )
  })
})

describe('focusSummary and focusHint', () => {
  test('count reads out of seven', () => {
    expect(focusSummary({ zones: ['chest', 'arms'], whole: false })).toBe('2 de 7')
  })

  test('whole body and nothing are named rather than counted', () => {
    expect(focusSummary({ zones: [], whole: true })).toBe('Todo el cuerpo')
    expect(focusSummary(NOTHING_CHOSEN)).toBe('Ninguna')
  })

  test('the two answered states each say something different', () => {
    expect(focusHint({ zones: ['chest'], whole: false })).not.toBe(
      focusHint({ zones: [], whole: true }),
    )
  })

  test('says nothing at all with nothing chosen', () => {
    // It used to say continuing without choosing was fine, and it no longer is.
    expect(focusHint(NOTHING_CHOSEN)).toBeUndefined()
  })
})

describe('allZoneSlugs', () => {
  test('lists every muscle a zone can reach on that face, without repeats', () => {
    for (const side of ['front', 'back'] as const) {
      const every = allZoneSlugs(side)
      expect(new Set(every).size).toBe(every.length)
      for (const entry of FOCUS_ZONES) {
        for (const slug of slugsForZone(entry.zone, side)) expect(every).toContain(slug)
      }
    }
  })

  test('carries nothing inert, so a resting colour never reaches the head', () => {
    for (const side of ['front', 'back'] as const) {
      for (const slug of INERT_SLUGS) expect(allZoneSlugs(side)).not.toContain(slug)
    }
  })
})

describe('areasFor', () => {
  test('sends the zones as they were declared', () => {
    expect(areasFor({ zones: ['chest', 'legs'], whole: false })).toEqual(['chest', 'legs'])
  })

  test('sends whole body as a member, never as an empty set', () => {
    // The empty array would be indistinguishable from an unanswered step, both
    // over the wire and as rows in the database.
    expect(areasFor({ zones: [], whole: true })).toEqual(['whole_body'])
  })

  test('sends nothing at all when nothing is chosen, which the button already blocks', () => {
    expect(areasFor(NOTHING_CHOSEN)).toEqual([])
  })
})

describe('selectionFromAreas', () => {
  test('reopens on the zones that were saved', () => {
    expect(selectionFromAreas(['chest', 'legs'])).toEqual({
      zones: ['chest', 'legs'],
      whole: false,
    })
  })

  test('restores the declared order, not the order the server sent', () => {
    // The database returns the set sorted by code, so without this the chips would
    // reorder themselves between a fresh screen and a resumed one.
    expect(selectionFromAreas(['abs', 'chest']).zones).toEqual(['chest', 'abs'])
  })

  test('reopens whole body', () => {
    expect(selectionFromAreas(['whole_body'])).toEqual({ zones: [], whole: true })
  })

  test('takes whole body as the answer even if a zone came with it', () => {
    // The API and the database both refuse that combination, so it can only arrive
    // from a future version. Whole body wins rather than drawing a state the
    // screen has no way to represent.
    expect(selectionFromAreas(['whole_body', 'chest'])).toEqual({ zones: [], whole: true })
  })

  test('reads nothing saved as nothing chosen', () => {
    expect(selectionFromAreas([])).toEqual(NOTHING_CHOSEN)
    expect(selectionFromAreas(undefined)).toEqual(NOTHING_CHOSEN)
  })

  test('drops a member it cannot draw instead of failing', () => {
    expect(selectionFromAreas(['chest', 'left_eyebrow'])).toEqual({
      zones: ['chest'],
      whole: false,
    })
    expect(selectionFromAreas(['left_eyebrow'])).toEqual(NOTHING_CHOSEN)
  })

  test('folds all seven back into whole body, agreeing with toggleFocus', () => {
    const every = FOCUS_ZONES.map((entry) => entry.zone)

    expect(selectionFromAreas(every)).toEqual({ zones: [], whole: true })
  })

  test('round trips every selection the screen can hold', () => {
    const cases: FocusSelection[] = [
      { zones: ['chest'], whole: false },
      { zones: ['chest', 'abs', 'legs'], whole: false },
      { zones: [], whole: true },
    ]

    for (const selection of cases) {
      expect(selectionFromAreas([...areasFor(selection)])).toEqual(selection)
    }
  })
})
