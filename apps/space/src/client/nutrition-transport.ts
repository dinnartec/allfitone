/**
 * The native half of the nutrition flow: the fetches, behind the same refresh the
 * execution flow uses.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost, authorizedRead, authorizedSend } from './index'
import {
  createNutritionFlow,
  type DailySummaryPage,
  type FoodPage,
  type FrequentFoodPage,
  type GoalDecision,
  type Goals,
  type GoalVersion,
  type MealPage,
  type NutritionFlow,
  type NutritionMeal,
  type RecognitionConsentState,
  type RecognitionResult,
} from './nutrition'
import { authenticated } from './session'

const query = (values: Record<string, string>) => new URLSearchParams(values).toString()

export function createSpaceNutritionFlow(): NutritionFlow {
  return createNutritionFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      recordMeal: (command, meal) =>
        authenticated((token) =>
          authorizedPost<NutritionMeal>('/space/v1/nutrition/meals', command, meal, token),
        ),
      readMeal: (mealId) =>
        authenticated((token) =>
          authorizedGet<NutritionMeal>(`/space/v1/nutrition/meals/${mealId}`, token),
        ),
      listMeals: (from, to) =>
        authenticated((token) =>
          authorizedGet<MealPage>(
            `/space/v1/nutrition/meals?${query({ from, to, limit: '100' })}`,
            token,
          ),
        ),
      reviseMeal: (command, mealId, ifMatch, patch) =>
        authenticated((token) =>
          authorizedSend<NutritionMeal>(
            'PATCH',
            `/space/v1/nutrition/meals/${mealId}`,
            command,
            patch,
            token,
            ifMatch,
          ),
        ),
      deleteMeal: (command, mealId) =>
        authenticated((token) =>
          authorizedSend<undefined>(
            'DELETE',
            `/space/v1/nutrition/meals/${mealId}`,
            command,
            undefined,
            token,
          ),
        ),
      readDays: (from, to, timezone) =>
        authenticated((token) =>
          authorizedGet<DailySummaryPage>(
            `/space/v1/nutrition/daily-summaries?${query({ from, to, timezone })}`,
            token,
          ),
        ),
      readGoals: () =>
        authenticated((token) => authorizedGet<Goals>('/space/v1/nutrition/goals', token)),
      publishGoal: (command, targets) =>
        authenticated((token) =>
          authorizedPost<GoalVersion>(
            '/space/v1/nutrition/goals/versions',
            command,
            { targets },
            token,
          ),
        ),
      decideGoal: (command, goalVersionId, decision) =>
        authenticated((token) =>
          authorizedPost<GoalDecision>(
            `/space/v1/nutrition/goal-versions/${goalVersionId}/decision`,
            command,
            { decision },
            token,
          ),
        ),
      searchFoods: (q) =>
        authenticated((token) =>
          authorizedGet<FoodPage>(`/space/v1/nutrition/foods?${query({ q, limit: '20' })}`, token),
        ),
      frequentFoods: () =>
        authenticated((token) =>
          authorizedGet<FrequentFoodPage>('/space/v1/nutrition/foods/frequent', token),
        ),
      // A read in effect: it stores nothing, so it carries no command (OP-NUT-016).
      recognize: (photo) =>
        authenticated((token) =>
          authorizedRead<RecognitionResult>('/space/v1/nutrition/recognitions', { photo }, token),
        ),
      readConsent: () =>
        authenticated((token) =>
          authorizedGet<RecognitionConsentState>('/space/v1/nutrition/recognition-consent', token),
        ),
      acceptConsent: (command, version) =>
        authenticated((token) =>
          authorizedSend<RecognitionConsentState>(
            'PUT',
            '/space/v1/nutrition/recognition-consent',
            command,
            { version },
            token,
          ),
        ),
    },
  })
}
