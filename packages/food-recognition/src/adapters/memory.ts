/**
 * A recogniser for tests: answers what it was told, or fails the way it was told, and
 * remembers what it was shown. The answer still goes through `checkAnswer`, so a test
 * sees exactly what the real adapter would let through.
 */

import { RecognitionError, type FoodRecognizer, type RecognitionFailure } from '../port.js'
import { checkAnswer } from '../validate.js'

export interface MemoryRecognizer extends FoodRecognizer {
  readonly seen: Uint8Array[]
  answer(raw: unknown): void
  failNext(failure: RecognitionFailure): void
}

export function createMemoryRecognizer(model = 'memory/recognizer'): MemoryRecognizer {
  let raw: unknown = { dish: null, items: [] }
  let failure: RecognitionFailure | null = null
  const seen: Uint8Array[] = []
  return {
    seen,
    answer(next) {
      raw = next
    },
    failNext(next) {
      failure = next
    },
    recognize(jpeg) {
      seen.push(jpeg)
      if (failure) {
        const thrown = new RecognitionError(failure)
        failure = null
        return Promise.reject(thrown)
      }
      try {
        return Promise.resolve({ ...checkAnswer(raw), model })
      } catch (cause) {
        return Promise.reject(
          cause instanceof Error ? cause : new RecognitionError('invalid-answer'),
        )
      }
    },
  }
}
