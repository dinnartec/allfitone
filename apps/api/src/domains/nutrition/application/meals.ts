/**
 * Meal use cases for Space.
 *
 * The token is carried through, never interpreted: its subject is resolved to a person inside
 * the command's own transaction, so this layer cannot record or delete for anyone else.
 *
 * The owner's view carries `photo`. No photo can be stored in this version, so a record that
 * claims one is a broken invariant and fails loudly instead of being served without it.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'

import type {
  MealCommand,
  MealDatabase,
  MealDeletion,
  MealListInput,
  MealRecord,
  MealRecording,
  MealResult,
  NutritionMeal,
} from '../domain/meals.js'

export interface MealPage {
  meals: NutritionMeal[]
  hasMore: boolean
}

export interface MealService {
  list(token: VerifiedToken, input: MealListInput): Promise<MealPage>
  record(
    token: VerifiedToken,
    input: Omit<MealCommand, 'requestId'> & { mealId: string; meal: MealRecording },
  ): Promise<MealResult<NutritionMeal>>
  delete(
    token: VerifiedToken,
    input: Omit<MealCommand, 'requestId'> & { mealId: string },
  ): Promise<MealResult<MealDeletion>>
}

export function createMealService(dependencies: {
  database: MealDatabase
  issuer: string
  requestId: () => string
}): MealService {
  const holder = (token: VerifiedToken) => ({
    issuer: dependencies.issuer,
    subject: String(token.subject),
  })

  return {
    list: async (token, input) => {
      const page = await dependencies.database.list({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      })
      return { meals: page.items.map(ownerView), hasMore: page.has_more }
    },
    record: async (token, input) => {
      const result = await dependencies.database.record({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      })
      return { resource: ownerView(result.resource), replayed: result.replayed }
    },
    delete: (token, input) =>
      dependencies.database.delete({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
  }
}

function ownerView(record: MealRecord): NutritionMeal {
  const { has_media: hasMedia, ...meal } = record
  if (hasMedia) throw new Error('A meal photo cannot be served in this version')
  return { ...meal, photo: null, applied_scopes: [] }
}
