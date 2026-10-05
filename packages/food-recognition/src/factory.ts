/**
 * The recogniser the environment describes. The model is pinned by default to the one
 * that passed the eval (ADR-041); changing `FOOD_RECOGNITION_MODEL` is the whole switch,
 * and it is only made after `bun run eval` passes with the new one.
 */

import { createGatewayRecognizer } from './adapters/gateway.js'
import type { FoodRecognizer } from './port.js'

export const DEFAULT_MODEL = 'google/gemini-3.5-flash-lite'

export function createFoodRecognizerFromEnv(
  env: Record<string, string | undefined>,
): FoodRecognizer {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim()
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not set')
  const model = env.FOOD_RECOGNITION_MODEL?.trim() || DEFAULT_MODEL
  if (!/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(model)) {
    throw new Error(
      'FOOD_RECOGNITION_MODEL must be an exact model slug such as google/gemini-3.5-flash-lite',
    )
  }
  return createGatewayRecognizer({ apiKey, model })
}
