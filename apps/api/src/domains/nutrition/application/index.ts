/**
 * The Space nutrition use cases.
 *
 * The rules live in PostgreSQL; this layer holds the person's identity to every call
 * and owns the one thing the database cannot do: the photo (ADR-039).
 *
 * **A photo is stored before the commit and removed after it.** It is sanitised first —
 * no EXIF, no location, bounded size — and a photo that cannot be read stores nothing.
 * The sanitised bytes go to the store under a fresh key; only then is the meal revised
 * to point at it. If the revision fails, the stored object is taken back out, so a
 * refused correction leaves no orphan. The photo it replaced, or the photo of a deleted
 * meal, is already queued in the database's `media_disposals` by the same commit; it is
 * removed from storage afterwards and the disposal sealed. A removal storage refuses
 * stays queued for a later sweep and does not undo what the person did.
 *
 * **Recognising a photo stores nothing and invents nothing** (ADR-041). Without the
 * current consent the photo never leaves Allfit. It is sanitised to 1024 px before it
 * does, the recogniser says only what it sees and how much, and every nutrient comes from
 * the catalogue food that name meets. Only when no food matches does the model's own
 * estimate stand in, marked `estimated` for the app to say so (ADR-041 as amended). What
 * the person should look at twice — low confidence, no catalogue food, a whole dish next
 * to its own parts — is marked for review.
 */

import { randomUUID } from 'node:crypto'
import { nutrientValue } from '@allfitone/contracts/nutrients'
import { DETAIL_CODES, type Estimate, type FoodRecognizer } from '@allfitone/food-recognition'
import type { ObjectStore } from '@allfitone/object-store'

import type {
  MealRow,
  MealRowPage,
  NutritionCommand,
  NutritionDatabase,
  NutritionDailySummaryPage,
  NutritionFood,
  NutritionFoodPage,
  NutritionFrequentFoodPage,
  NutritionPhotoUpload,
  NutritionRecognition,
  NutritionRecognitionConsent,
  NutritionGoalDecision,
  NutritionGoals,
  NutritionGoalVersion,
  NutritionMeal,
  NutritionMealCreate,
  NutritionMealPage,
  NutritionMealPatch,
  PhotoSanitizer,
  SelfGoalCreate,
} from '../domain/index.js'

/** The longest a phone may hold a read of a private photo (contract, ADR-027). */
const SIGNED_SECONDS = 300
/** The consent text a person must have accepted before a photo is recognised. */
export const CURRENT_CONSENT_VERSION = '2026-10-04'
/** Enough for a model to see a plate; less to send than what is kept. */
const RECOGNITION_SIDE = 1024
const SURE_ENOUGH = 0.6

/** Recognition was asked for before the person accepted its current consent. */
export class ConsentRequired extends Error {
  constructor() {
    super('recognition consent is required')
    this.name = 'ConsentRequired'
  }
}

type NutrientValue = NutritionRecognition['items'][number]['nutrients'][number]

// What an estimate may carry, in the order it is answered: energy and macros, then detail.
const ESTIMATED = ['energy', 'protein', 'carbohydrates', 'fat', ...DETAIL_CODES] as const

const tenth = (value: number) => Math.round(value * 10) / 10

/** The model's estimate as nutrient values, leaving out what it did not say. */
function estimatedNutrients(estimate: Estimate): NutrientValue[] {
  const values: NutrientValue[] = []
  for (const code of ESTIMATED) {
    const value = estimate[code]
    if (value !== undefined) values.push(nutrientValue(code, tenth(value)))
  }
  return values
}

/** A catalogue food's nutrients for the grams recognised, to a tenth. */
export function nutrientsFor(food: NutritionFood | null, grams: number): NutrientValue[] {
  if (!food) return []
  return food.nutrients.map((nutrient) =>
    nutrientValue(nutrient.nutrient_code, tenth((nutrient.value_per_100g * grams) / 100)),
  )
}

export interface SpaceNutritionService {
  recordMeal(
    input: NutritionCommand & { personId: string; meal: NutritionMealCreate },
  ): Promise<NutritionMeal | null>
  readMeal(input: {
    personId: string
    mealId: string
    requestId: string
  }): Promise<NutritionMeal | null>
  listMeals(input: Parameters<NutritionDatabase['listMeals']>[0]): Promise<NutritionMealPage>
  reviseMeal(
    input: NutritionCommand & {
      personId: string
      mealId: string
      revision: number
      patch: NutritionMealPatch
    },
  ): Promise<NutritionMeal>
  deleteMeal(input: NutritionCommand & { personId: string; mealId: string }): Promise<void>
  readDailySummaries(
    input: Parameters<NutritionDatabase['readDailySummaries']>[0],
  ): Promise<NutritionDailySummaryPage>
  readGoals(input: { personId: string; requestId: string }): Promise<NutritionGoals>
  publishGoal(
    input: NutritionCommand & { personId: string; goal: SelfGoalCreate },
  ): Promise<NutritionGoalVersion>
  decideGoal(
    input: NutritionCommand & {
      personId: string
      goalVersionId: string
      decision: 'accepted' | 'rejected'
    },
  ): Promise<NutritionGoalDecision>
  searchFoods(input: Parameters<NutritionDatabase['searchFoods']>[0]): Promise<NutritionFoodPage>
  frequentFoods(input: { personId: string; requestId: string }): Promise<NutritionFrequentFoodPage>
  recognize(input: {
    personId: string
    photo: NutritionPhotoUpload
    requestId: string
  }): Promise<NutritionRecognition>
  readConsent(input: { personId: string; requestId: string }): Promise<NutritionRecognitionConsent>
  acceptConsent(
    input: NutritionCommand & { personId: string; version: string },
  ): Promise<NutritionRecognitionConsent>
}

export type { NutritionMeal }

export function createSpaceNutritionService(
  database: NutritionDatabase,
  store: ObjectStore,
  sanitizer: PhotoSanitizer,
  recognizer: FoodRecognizer,
): SpaceNutritionService {
  const consentOf = async (
    personId: string,
    requestId: string,
  ): Promise<NutritionRecognitionConsent> => {
    const row = await database.readConsent({ personId, requestId })
    return {
      current_version: CURRENT_CONSENT_VERSION,
      accepted_version: row?.accepted_version ?? null,
      accepted_at: row?.accepted_at ?? null,
    }
  }

  const toMeal = async (row: MealRow): Promise<NutritionMeal> => {
    const { media_ref, ...meal } = row
    const photo = media_ref
      ? await store.signedGet(media_ref, SIGNED_SECONDS).then((read) => ({
          url: read.url,
          expires_at: read.expiresAt.toISOString(),
          method: 'GET' as const,
        }))
      : null
    return { ...meal, photo, applied_scopes: [] }
  }

  // After the commit, and never in its way: what is left stays queued for a sweep.
  const dispose = async (personId: string, mediaRef: string | null) => {
    if (!mediaRef) return
    try {
      await store.remove(mediaRef)
      await database.sealDisposal({ personId, mediaRef })
    } catch (cause) {
      console.warn('[nutrition] photo left queued for disposal', {
        detail: String(cause).slice(0, 160),
      })
    }
  }

  return {
    async recordMeal(input) {
      const row = await database.recordMeal(input)
      return row ? toMeal(row) : null
    },

    async readMeal(input) {
      const row = await database.readMeal(input)
      return row ? toMeal(row) : null
    },

    async listMeals(input) {
      const page: MealRowPage = await database.listMeals(input)
      return { data: await Promise.all(page.data.map(toMeal)), page: page.page }
    },

    async reviseMeal({ patch, ...input }) {
      const { photo, remove_photo, ...rest } = patch
      let stored: string | undefined
      if (photo) {
        const clean = await sanitizer.sanitize(Buffer.from(photo.content, 'base64'))
        stored = `nutrition/${input.personId}/${input.mealId}/${randomUUID()}.jpg`
        await store.put(stored, clean, 'image/jpeg')
      }
      const media = stored
        ? { set: stored }
        : remove_photo || photo === null
          ? { remove: true as const }
          : null

      let revised: Awaited<ReturnType<NutritionDatabase['reviseMeal']>>
      try {
        revised = await database.reviseMeal({ ...input, patch: rest, media })
      } catch (cause) {
        if (stored) await store.remove(stored).catch(() => undefined)
        throw cause
      }

      const { disposed_media_ref, ...row } = revised
      await dispose(input.personId, disposed_media_ref)
      return toMeal(row)
    },

    async deleteMeal(input) {
      const { disposed_media_ref } = await database.deleteMeal(input)
      await dispose(input.personId, disposed_media_ref)
    },

    readDailySummaries: (input) => database.readDailySummaries(input),
    readGoals: (input) => database.readGoals(input),
    publishGoal: (input) => database.publishGoal(input),
    decideGoal: (input) => database.decideGoal(input),
    searchFoods: (input) => database.searchFoods(input),
    frequentFoods: (input) => database.frequentFoods(input),
    readConsent: ({ personId, requestId }) => consentOf(personId, requestId),

    async acceptConsent(input) {
      await database.acceptConsent(input)
      return consentOf(input.personId, '')
    },

    async recognize({ personId, photo, requestId }) {
      // The plan first: without it the photo is not even sanitised.
      await database.requireRecognition({ personId, requestId })
      const consent = await consentOf(personId, requestId)
      if (consent.accepted_version !== CURRENT_CONSENT_VERSION) throw new ConsentRequired()

      const clean = await sanitizer.sanitize(Buffer.from(photo.content, 'base64'), RECOGNITION_SIDE)
      const seen = await recognizer.recognize(clean)
      const foods = await database.matchFoods({
        personId,
        names: seen.items.map((item) => item.name),
      })
      const several = seen.items.length > 1
      return {
        dish: seen.dish,
        model: seen.model,
        items: seen.items.map((item, at) => {
          const food = foods[at] ?? null
          // The catalogue first; the model's guess only where it has no food, and said so.
          const estimated = !food && item.estimate !== null
          return {
            name: item.name,
            units: item.units,
            grams: item.grams,
            confidence: item.confidence,
            at: item.at,
            icon: item.icon,
            estimated,
            needs_review:
              item.confidence < SURE_ENOUGH || !food || (several && food.kind === 'dish'),
            food,
            nutrients:
              estimated && item.estimate
                ? estimatedNutrients(item.estimate)
                : nutrientsFor(food, item.grams),
          }
        }),
      }
    },
  }
}
