/**
 * The discipline screen, minus the rendering.
 *
 * Everything decidable lives here for the same reason it does on every other step:
 * `bun test src` is the only glob this workspace runs and no component renderer is
 * installed, so anything left in `app/` cannot be tested.
 *
 * **Six cards, one answer.** The catalogue below is the whole carousel — the five that
 * are not ready are drawn on purpose, because knowing what Allfit is going to cover is
 * part of the promise. `available` is what keeps that from becoming a false promise:
 * they cannot be chosen, and nothing here offers to tell anybody when they are ready,
 * because no interest is recorded.
 *
 * **The goal depends on the discipline**, which is why `goalsFor` lives beside the
 * catalogue rather than in `goal-form.ts`: the mapping is a property of the discipline,
 * and keeping it here means adding one means editing one place.
 *
 * The mapping is deliberately **not** in PostgreSQL. It is not an invariant and not a
 * security boundary — nothing breaks if strength and "run a race" end up side by side —
 * and it is curation that will change with every discipline that lands. Enforced in the
 * database it would refuse tomorrow a value that was legitimate when it was declared.
 */

import type { TrainingDiscipline } from './onboarding'
import type { TrainingGoal } from './goal-form'

export interface DisciplineCard {
  /** Matches `identity.profile_attributes.allowed_values` for `training_discipline`. */
  readonly code: string
  /** The two lines of the title, drawn at different weights. */
  readonly title: readonly [string, string]
  /** Three examples, which is how somebody recognises their own practice. */
  readonly practices: readonly string[]
  /** Whether it can be chosen today. Only one is. */
  readonly available: boolean
}

const STRENGTH: DisciplineCard = {
  code: 'strength',
  title: ['FUERZA', 'MUSCULACIÓN'],
  practices: ['GYM / FISICOCULTURISMO', 'POWERLIFTING', 'CALISTENIA'],
  available: true,
}

/**
 * In the order the carousel shows them, with the one that is ready first — somebody
 * who swipes past everything still lands on a screen they can leave.
 */
export const DISCIPLINES: readonly DisciplineCard[] = [
  STRENGTH,
  {
    code: 'high_intensity',
    title: ['ALTA', 'INTENSIDAD'],
    practices: ['CROSSFIT / FUNCIONAL', 'HIIT', 'BOOTCAMP'],
    available: false,
  },
  {
    code: 'endurance_cardio',
    title: ['RESISTENCIA', 'Y CARDIO'],
    practices: ['RUNNING / ATLETISMO', 'CICLISMO / SPINNING', 'NATACIÓN'],
    available: false,
  },
  {
    code: 'combat_sports',
    title: ['DEPORTES', 'DE COMBATE'],
    practices: ['BOXEO / KICKBOXING', 'CARDIO BOX / BODY COMBAT'],
    available: false,
  },
  {
    code: 'wellbeing_control',
    title: ['BIENESTAR', 'Y CONTROL'],
    practices: ['YOGA', 'PILATES', 'BARRE', 'ESTIRAMIENTOS / MOVILIDAD'],
    available: false,
  },
  {
    code: 'rhythm_classes',
    title: ['RITMOS', 'Y CLASES'],
    practices: ['ZUMBA / DANCE FITNESS'],
    available: false,
  },
]

/** What the seal says. The unavailable ones promise nothing, because nothing is kept. */
export function sealFor(card: DisciplineCard): string {
  return card.available ? 'LISTA HOY' : 'PRÓXIMAMENTE'
}

export function disciplineAt(index: number): DisciplineCard {
  const clamped = Math.min(Math.max(index, 0), DISCIPLINES.length - 1)
  const card = DISCIPLINES[clamped]
  // The list is a module constant with six members, so this cannot happen. Answering
  // the first card rather than asserting keeps a bad index off the screen either way.
  return card ?? STRENGTH
}

export function indexOfDiscipline(code: string | null | undefined): number {
  const found = DISCIPLINES.findIndex((card) => card.code === code)
  return found === -1 ? 0 : found
}

export interface DisciplineSubmission {
  readonly card: DisciplineCard
  readonly submitting: boolean
  readonly sessionExpired: boolean
}

export function canSubmitDiscipline({
  card,
  submitting,
  sessionExpired,
}: DisciplineSubmission): boolean {
  if (submitting || sessionExpired) return false
  return card.available
}

/**
 * The goals a discipline pursues, in the order the goal screen lists them.
 *
 * Strength drops `run_a_race`: it is the one of the five that strength training does
 * not chase, and offering it would promise a plan this discipline is never going to
 * write. The other five disciplines are unreachable today, so they answer the full list
 * rather than a guess nobody has made yet.
 */
export function goalsFor(
  discipline: TrainingDiscipline | null | undefined,
  all: readonly TrainingGoal[],
): readonly TrainingGoal[] {
  if (discipline !== 'strength') return all
  return all.filter((goal) => goal !== 'run_a_race')
}
