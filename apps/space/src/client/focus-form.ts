/**
 * Muscle focus — the logic behind the "what do you want to focus on" screen.
 *
 * Everything decidable lives here rather than in the screen, because `bun test src`
 * is the only glob this workspace runs and no component renderer is installed:
 * whatever stays in `app/` cannot be checked at all.
 *
 * Seven zones, not one entry per muscle. HU-SP-097 asks for zones, and a zone maps
 * to several of the library's parts — "arms" lights the biceps, triceps and forearm
 * together, on both faces. The mapping is data here so the screen never reasons
 * about anatomy.
 *
 * "Whole body" is one of the options rather than a row underneath, and it is
 * exclusive with the zones in both directions. It also collapses: marking all seven
 * by hand and choosing whole body draw exactly the same figure, but they mean
 * opposite things — "emphasise everything" against "no emphasis, my goal decides".
 * Two states with one drawing and opposite meaning is a defect waiting, so the
 * seventh mark folds into whole body.
 *
 * Nothing arrives selected. A default would write an emphasis nobody declared. But
 * continuing does require an answer, and `whole_body` is one — it is how someone
 * says "no emphasis" without leaving the question open, and it is a member of the
 * database catalogue for exactly that reason: without it, "no emphasis" and "not
 * answered" would both be zero rows.
 *
 * The head, hands and feet never light, not even under whole body: they are not
 * training zones. They are also not touchable, which matters because a target that
 * highlights nothing but reacts to a tap reads as broken.
 */

import type { FocusArea } from './onboarding'

/** The library's own part names, as verified against its `Slug` union. */
export type BodySlug =
  | 'abs'
  | 'adductors'
  | 'ankles'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'deltoids'
  | 'feet'
  | 'forearm'
  | 'gluteal'
  | 'hair'
  | 'hamstring'
  | 'hands'
  | 'head'
  | 'knees'
  | 'lower-back'
  | 'neck'
  | 'obliques'
  | 'quadriceps'
  | 'tibialis'
  | 'trapezius'
  | 'triceps'
  | 'upper-back'

export type BodySide = 'front' | 'back'

export type FocusZone = 'chest' | 'back' | 'shoulders' | 'arms' | 'abs' | 'glutes' | 'legs'

/** The answer that means "no emphasis", kept apart from the zone codes. */
export const WHOLE_BODY = 'whole_body' as const
export type FocusChoice = FocusZone | typeof WHOLE_BODY

interface ZoneDefinition {
  readonly zone: FocusZone
  readonly name: string
  readonly front: readonly BodySlug[]
  readonly back: readonly BodySlug[]
}

/**
 * Zone to muscles, in the order the chips are listed. "Abdomen" rather than "core":
 * core is the gym's word and covers the lower back too, which belongs to the back
 * zone here, so it would name something wider than what it lights.
 */
export const FOCUS_ZONES: readonly ZoneDefinition[] = [
  { zone: 'chest', name: 'Pecho', front: ['chest'], back: [] },
  {
    zone: 'back',
    name: 'Espalda',
    front: ['trapezius'],
    back: ['trapezius', 'upper-back', 'lower-back'],
  },
  { zone: 'shoulders', name: 'Hombros', front: ['deltoids'], back: ['deltoids'] },
  {
    zone: 'arms',
    name: 'Brazos',
    front: ['biceps', 'triceps', 'forearm'],
    back: ['triceps', 'forearm'],
  },
  { zone: 'abs', name: 'Abdomen', front: ['abs', 'obliques'], back: [] },
  { zone: 'glutes', name: 'Glúteos', front: [], back: ['gluteal'] },
  {
    zone: 'legs',
    name: 'Piernas',
    front: ['quadriceps', 'adductors', 'tibialis', 'calves'],
    back: ['hamstring', 'adductors', 'calves'],
  },
]

/** Never lit and never touchable: none of these is a training zone. */
export const INERT_SLUGS: readonly BodySlug[] = [
  'head',
  'hair',
  'neck',
  'hands',
  'feet',
  'ankles',
  'knees',
]

export interface FocusSelection {
  /** The zones marked one by one. Empty when whole body is the answer. */
  readonly zones: readonly FocusZone[]
  /** True when the answer is "no emphasis", which excludes every zone. */
  readonly whole: boolean
}

export const NOTHING_CHOSEN: FocusSelection = { zones: [], whole: false }

/** Whether the question was answered at all, which is not the same as a value. */
export function isAnswered(selection: FocusSelection): boolean {
  return selection.whole || selection.zones.length > 0
}

/**
 * Toggling one choice. Whole body clears the zones and any zone clears whole body,
 * and the seventh zone folds into whole body rather than drawing the same figure
 * with the opposite meaning.
 */
export function toggleFocus(selection: FocusSelection, choice: FocusChoice): FocusSelection {
  if (choice === WHOLE_BODY) {
    return selection.whole ? NOTHING_CHOSEN : { zones: [], whole: true }
  }

  const held = selection.zones.includes(choice)
  const zones = held
    ? selection.zones.filter((zone) => zone !== choice)
    : [
        ...FOCUS_ZONES.map((entry) => entry.zone).filter(
          (zone) => zone === choice || selection.zones.includes(zone),
        ),
      ]

  if (zones.length === FOCUS_ZONES.length) return { zones: [], whole: true }
  return { zones, whole: false }
}

/** Every muscle a zone lights on one face. */
export function slugsForZone(zone: FocusZone, side: BodySide): readonly BodySlug[] {
  const entry = FOCUS_ZONES.find((candidate) => candidate.zone === zone)
  if (!entry) return []
  return side === 'front' ? entry.front : entry.back
}

/** Which zone owns the muscle under the finger, or none if it is inert. */
export function zoneForSlug(slug: BodySlug, side: BodySide): FocusZone | undefined {
  if (INERT_SLUGS.includes(slug)) return undefined
  return FOCUS_ZONES.find((entry) => slugsForZone(entry.zone, side).includes(slug))?.zone
}

/**
 * Every muscle a zone can light on one face. The library's own assets hardcode
 * `color: "#3f3f3f"` on 18 of 19 parts, and that beats `defaultFill`, so the
 * screen has to state the resting colour for each part rather than rely on a
 * default it never reaches.
 */
export function allZoneSlugs(side: BodySide): readonly BodySlug[] {
  const every = FOCUS_ZONES.flatMap((entry) => slugsForZone(entry.zone, side))
  return [...new Set(every)]
}

/** What lights on one face for a given selection. */
export function litSlugs(selection: FocusSelection, side: BodySide): readonly BodySlug[] {
  if (selection.whole) {
    const all = FOCUS_ZONES.flatMap((entry) => slugsForZone(entry.zone, side))
    return [...new Set(all)]
  }
  const lit = selection.zones.flatMap((zone) => slugsForZone(zone, side))
  return [...new Set(lit)]
}

/**
 * Which body to draw. Female brings the woman; male and declining bring the man.
 * Declining leaves no value, and unlike the goal screen there is one figure here
 * rather than five cards, so there is nothing to mix — a default had to be picked
 * and said out loud.
 */
export function bodyGender(biologicalSex: 'male' | 'female' | null): 'male' | 'female' {
  return biologicalSex === 'female' ? 'female' : 'male'
}

/**
 * The library renders at a fixed 400×200 points and multiplies both by `scale`, in
 * both sexes and both faces. So one scale sizes everything and the feet line up
 * without measuring: the differing viewBoxes are absorbed by the SVG itself.
 */
export const BODY_BASE_HEIGHT = 400

export function bodyScale(availableHeight: number): number {
  if (availableHeight <= 0) return 0
  return availableHeight / BODY_BASE_HEIGHT
}

/**
 * Continuing requires an answer, and "whole body" is one — it is the way to say
 * "no emphasis" without leaving the question unanswered. Criterion 3 of HU-SP-097
 * was amended to match on 24 August 2026; it used to allow pointing at none.
 */
export function canSubmitFocus({
  selection,
  submitting,
  sessionExpired,
}: {
  selection: FocusSelection
  submitting: boolean
  sessionExpired: boolean
}): boolean {
  if (submitting || sessionExpired) return false
  return isAnswered(selection)
}

/** What the screen says about the current selection, in the person's own terms. */
export function focusSummary(selection: FocusSelection): string {
  if (selection.whole) return 'Todo el cuerpo'
  if (selection.zones.length === 0) return 'Ninguna'
  return `${selection.zones.length} de ${FOCUS_ZONES.length}`
}

/**
 * No line for the empty state any more: it used to say that continuing without
 * choosing was fine, and it no longer is.
 */
export function focusHint(selection: FocusSelection): string | undefined {
  if (selection.whole) return 'Sin énfasis: lo reparte tu objetivo principal.'
  if (selection.zones.length > 0) return 'Ahí cargaremos más volumen, sin dejar el resto fuera.'
  return undefined
}

/**
 * The selection as the contract carries it. `whole_body` is a member of the set
 * rather than an empty one, so every answer has at least one member and the empty
 * array never reaches the wire — which is what keeps "no emphasis" distinguishable
 * from "not answered" all the way down to the row.
 */
export function areasFor(selection: FocusSelection): readonly FocusArea[] {
  if (selection.whole) return [WHOLE_BODY]
  return selection.zones
}

/**
 * And back, for the screen that reopens on an answer already given. An unknown
 * member is dropped rather than thrown: the catalogue can gain one before this app
 * version knows about it, and a zone it cannot draw must not blank the screen.
 */
export function selectionFromAreas(areas: readonly string[] | undefined): FocusSelection {
  if (!areas || areas.length === 0) return NOTHING_CHOSEN
  if (areas.includes(WHOLE_BODY)) return { zones: [], whole: true }

  const known = FOCUS_ZONES.map((entry) => entry.zone).filter((zone) => areas.includes(zone))
  if (known.length === 0) return NOTHING_CHOSEN
  // Seven zones and whole body draw the same figure and mean the opposite, and
  // `toggleFocus` already folds that boundary. Reading has to agree with it.
  if (known.length === FOCUS_ZONES.length) return { zones: [], whole: true }
  return { zones: known, whole: false }
}
