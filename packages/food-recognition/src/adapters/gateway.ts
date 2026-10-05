/**
 * Recognition through Vercel AI Gateway with the AI SDK (ADR-041).
 *
 * - **One model, by exact version**, and no `models` fallback list: a model that has not
 *   passed the eval never answers in its place. A failure is a failure, and the app offers
 *   the search.
 * - **Zero data retention on every request, routed only through Vertex.** The Gateway's ZDR
 *   agreement with Google covers Vertex AI, not AI Studio, so `only: ['vertex']` is what
 *   makes the retention promise hold; were Vertex not to offer the model, the request fails
 *   with `no_providers_available` instead of quietly going elsewhere.
 * - **The schema is checked twice**: by the SDK, for shape, and by `checkAnswer`, for what
 *   may reach a diary.
 * - **Where each food sits** is asked on Gemini's native 0–1000 grid, which it answers far
 *   more reliably than fractions, and turned into fractions here.
 */

import { createGateway, generateText, JSONParseError, Output, TypeValidationError } from 'ai'
import { z } from 'zod'

import { DETAIL_CODES, FOOD_GROUPS, RecognitionError, type FoodRecognizer } from '../port.js'
import { RECOGNITION_PROMPT } from '../prompt.js'
import { checkAnswer } from '../validate.js'

export interface GatewaySettings {
  readonly apiKey: string
  readonly model: string
  /** The inference providers allowed, by Gateway slug; Vertex by default (see above). */
  readonly providers?: readonly string[]
  readonly timeoutMs?: number
}

// The detail is optional: the model says what it can, and what it cannot stays unsaid.
const DETAIL = Object.fromEntries(DETAIL_CODES.map((code) => [code, z.number().optional()]))

const ANSWER = z.object({
  dish: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      units: z.number(),
      grams: z.number(),
      confidence: z.number(),
      at: z.object({ x: z.number(), y: z.number() }),
      icon: z.enum(FOOD_GROUPS),
      estimate: z.object({
        energy: z.number(),
        protein: z.number(),
        carbohydrates: z.number(),
        fat: z.number(),
        ...DETAIL,
      }),
    }),
  ),
})

export function createGatewayRecognizer(settings: GatewaySettings): FoodRecognizer {
  const gateway = createGateway({ apiKey: settings.apiKey })
  const timeout = settings.timeoutMs ?? 15_000
  return {
    async recognize(jpeg, signal) {
      const deadline = AbortSignal.timeout(timeout)
      let output: unknown
      try {
        const result = await generateText({
          model: gateway(settings.model),
          maxRetries: 1,
          abortSignal: signal ? AbortSignal.any([signal, deadline]) : deadline,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: jpeg, mediaType: 'image/jpeg' },
                { type: 'text', text: RECOGNITION_PROMPT },
              ],
            },
          ],
          output: Output.object({ schema: ANSWER }),
          providerOptions: {
            gateway: { only: [...(settings.providers ?? ['vertex'])], zeroDataRetention: true },
          },
        })
        // Gemini points on its own 0–1000 grid; the port speaks fractions of the photo.
        output = {
          ...result.output,
          items: result.output.items.map((item) => ({
            ...item,
            at: { x: item.at.x / 1000, y: item.at.y / 1000 },
          })),
        }
      } catch (cause) {
        const malformed = cause instanceof TypeValidationError || cause instanceof JSONParseError
        throw new RecognitionError(malformed ? 'invalid-answer' : 'unavailable', cause)
      }
      return { ...checkAnswer(output), model: settings.model }
    },
  }
}
