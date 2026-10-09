/**
 * What a person eats and the goal they keep, as the contract shapes it (ADR-027).
 *
 * Every Space-facing type comes from the OpenAPI document. The rows are those shapes as
 * PostgreSQL answers them: a meal carries its storage key, which the service turns into
 * a signed read and drops, so the key never leaves the API (ADR-039).
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type NutritionMeal = AllfitV1Schemas['NutritionMeal']
export type NutritionMealCreate = AllfitV1Schemas['NutritionMealCreate']
export type NutritionMealPatch = AllfitV1Schemas['NutritionMealPatch']
export type NutritionMealPage = AllfitV1Schemas['NutritionMealPage']
export type NutritionDailySummaryPage = AllfitV1Schemas['NutritionDailySummaryPage']
export type NutritionGoals = AllfitV1Schemas['NutritionGoals']
export type NutritionGoalVersion = AllfitV1Schemas['NutritionGoalVersion']
export type SelfGoalCreate = AllfitV1Schemas['SelfNutritionGoalVersionCreate']
export type NutritionGoalDecision = AllfitV1Schemas['NutritionGoalDecision']
export type NutritionFood = AllfitV1Schemas['NutritionFood']
export type NutritionFoodPage = AllfitV1Schemas['NutritionFoodPage']
export type NutritionFrequentFoodPage = AllfitV1Schemas['NutritionFrequentFoodPage']
export type NutritionRecognition = AllfitV1Schemas['NutritionRecognition']
export type NutritionRecognitionConsent = AllfitV1Schemas['NutritionRecognitionConsent']
export type NutritionPhotoUpload = AllfitV1Schemas['NutritionPhotoUpload']

/** The consent as the database keeps it; the current version is the API's to say. */
export type ConsentRow = Omit<NutritionRecognitionConsent, 'current_version'>

/** A meal as the database holds it: the photo is still a key. */
export type MealRow = Omit<NutritionMeal, 'photo' | 'applied_scopes'> & { media_ref: string | null }

export interface MealRowPage {
  readonly data: readonly MealRow[]
  readonly page: NutritionMealPage['page']
}

export interface NutritionCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Buffer
}

/** What a correction does to the photo: a new key, taking it away, or nothing. */
export type MediaChange = { readonly set: string } | { readonly remove: true } | null

export interface NutritionDatabase {
  recordMeal(
    input: NutritionCommand & { personId: string; meal: NutritionMealCreate },
  ): Promise<MealRow | null>
  /** Null when it does not exist or is not this person's — the same answer, on purpose. */
  readMeal(input: { personId: string; mealId: string; requestId: string }): Promise<MealRow | null>
  listMeals(input: {
    personId: string
    from: string
    to: string
    cursor: string | null
    limit: number
    requestId: string
  }): Promise<MealRowPage>
  /** A stale revision is refused with SQLSTATE 40001; another person's with 42501. */
  reviseMeal(
    input: NutritionCommand & {
      personId: string
      mealId: string
      revision: number
      patch: Omit<NutritionMealPatch, 'photo' | 'remove_photo'>
      media: MediaChange
    },
  ): Promise<MealRow & { disposed_media_ref: string | null }>
  deleteMeal(
    input: NutritionCommand & { personId: string; mealId: string },
  ): Promise<{ disposed_media_ref: string | null }>
  /** Storage removed the object: the disposal is done. */
  sealDisposal(input: { personId: string; mediaRef: string }): Promise<void>
  readDailySummaries(input: {
    personId: string
    from: string
    to: string
    timezone: string | null
    requestId: string
  }): Promise<NutritionDailySummaryPage>
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
  searchFoods(input: {
    personId: string
    query: string
    limit: number
    requestId: string
  }): Promise<NutritionFoodPage>
  frequentFoods(input: { personId: string; requestId: string }): Promise<NutritionFrequentFoodPage>
  /** One answer per name, in order: its catalogue food, or null (ADR-041). */
  matchFoods(input: {
    personId: string
    names: readonly string[]
  }): Promise<(NutritionFood | null)[]>
  /** Null when the actor is not this person. */
  readConsent(input: { personId: string; requestId: string }): Promise<ConsentRow | null>
  acceptConsent(
    input: NutritionCommand & { personId: string; version: string },
  ): Promise<ConsentRow>
}

/** Makes a photo safe to keep: no EXIF, no location, a bounded size, one format. */
export interface PhotoSanitizer {
  /** `longestSide` caps the image; 1600 px when it is not said. */
  sanitize(bytes: Uint8Array, longestSide?: number): Promise<Uint8Array>
}

/** The photo could not be read as an image, so nothing is stored (fails closed). */
export class PhotoRejected extends Error {
  constructor(cause: unknown) {
    super('the photo could not be sanitised', { cause })
    this.name = 'PhotoRejected'
  }
}
