import { describe, expect, test } from 'bun:test'

import { createMemoryRecognizer } from './adapters/memory.js'
import { createFoodRecognizerFromEnv } from './factory.js'
import { RecognitionError } from './port.js'

describe('the recogniser (ADR-041)', () => {
  test('T-REC-UNIT-06 the factory names the missing key and refuses a model alias', () => {
    expect(() => createFoodRecognizerFromEnv({})).toThrow('AI_GATEWAY_API_KEY is not set')
    expect(() =>
      createFoodRecognizerFromEnv({
        AI_GATEWAY_API_KEY: 'k',
        FOOD_RECOGNITION_MODEL: 'gemini latest',
      }),
    ).toThrow('exact model slug')
    expect(createFoodRecognizerFromEnv({ AI_GATEWAY_API_KEY: 'k' })).toHaveProperty('recognize')
  })

  test('T-REC-UNIT-07 the memory recogniser answers through the same checks, fails when told, and keeps what it saw', async () => {
    const recognizer = createMemoryRecognizer('memory/test')
    recognizer.answer({
      dish: 'ajiaco',
      items: [
        { name: 'papa', units: 1, grams: 60, confidence: 0.8 },
        { name: '<b>', units: 1, grams: 5, confidence: 1 },
      ],
    })
    const jpeg = new Uint8Array([1, 2, 3])
    expect(await recognizer.recognize(jpeg)).toEqual({
      dish: 'ajiaco',
      items: [
        {
          name: 'papa',
          units: 1,
          grams: 60,
          confidence: 0.8,
          at: null,
          icon: null,
          estimate: null,
        },
      ],
      model: 'memory/test',
    })
    expect(recognizer.seen).toEqual([jpeg])
    recognizer.failNext('unavailable')
    await expect(recognizer.recognize(jpeg)).rejects.toThrow(new RecognitionError('unavailable'))
  })
})
