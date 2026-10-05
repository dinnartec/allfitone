import { describe, expect, test } from 'bun:test'
import {
  createMemoryRecognizer,
  RecognitionError,
  type MemoryRecognizer,
} from '@allfitone/food-recognition'
import { createMemoryObjectStore } from '@allfitone/object-store'

import type { MealRow, NutritionDatabase, PhotoSanitizer } from '../domain/index.js'
import { PhotoRejected, type NutritionFood } from '../domain/index.js'
import { ConsentRequired, CURRENT_CONSENT_VERSION, createSpaceNutritionService } from './index.js'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const MEAL = '019f1000-0000-7000-8000-000000000101'
const command = { idempotencyKey: 'k', commandId: 'c', requestHash: Buffer.alloc(32) }

const row = (overrides: Partial<MealRow> = {}): MealRow => ({
  id: MEAL,
  occurred_at: '2026-09-30T18:10:00.000Z',
  local_date: '2026-09-30',
  timezone: 'America/Bogota',
  meal_type: 'lunch',
  note: null,
  revision_number: 1,
  items: [],
  media_ref: null,
  ...overrides,
})

function harness(
  database: Partial<NutritionDatabase> = {},
  sanitizer?: PhotoSanitizer,
  recognizer: MemoryRecognizer = createMemoryRecognizer('google/gemini-3.5-flash-lite'),
) {
  const store = createMemoryObjectStore()
  const sealed: string[] = []
  const db = {
    reviseMeal: async ({ media }) => ({
      ...row({ media_ref: media && 'set' in media ? media.set : null }),
      disposed_media_ref: 'nutrition/old.jpg',
    }),
    sealDisposal: async ({ mediaRef }) => {
      sealed.push(mediaRef)
    },
    readMeal: async () => row({ media_ref: 'nutrition/p/m/photo.jpg' }),
    ...database,
  } as NutritionDatabase
  const clean: PhotoSanitizer = sanitizer ?? { sanitize: async () => new Uint8Array([9, 9]) }
  return {
    service: createSpaceNutritionService(db, store, clean, recognizer),
    store,
    sealed,
    recognizer,
  }
}

const photo = {
  content_type: 'image/jpeg' as const,
  content: Buffer.from([1, 2, 3]).toString('base64'),
}

describe('a meal is answered with its photo signed, never its key (ADR-039)', () => {
  test('T-NUT-API-UNIT-01 the key becomes a five-minute read', async () => {
    const meal = await harness().service.readMeal({ personId: PERSON, mealId: MEAL, requestId: '' })

    expect(meal?.photo?.method).toBe('GET')
    expect(meal?.photo?.url).toContain('photo.jpg')
    expect(meal?.photo?.url).toContain('expires=300')
    expect(JSON.stringify(meal)).not.toContain('media_ref')
  })
})

describe('a photo is sanitised, stored, committed, and the old one removed', () => {
  test('T-NUT-API-UNIT-02 what is stored is the sanitised image under a fresh key of this meal', async () => {
    const { service, store, sealed } = harness()
    await service.reviseMeal({
      ...command,
      personId: PERSON,
      mealId: MEAL,
      revision: 1,
      patch: { photo, remove_photo: false },
    })

    const [key, object] = [...store.objects.entries()][0] ?? []
    expect(key).toMatch(new RegExp(`^nutrition/${PERSON}/${MEAL}/[0-9a-f-]{36}\\.jpg$`))
    expect(object?.bytes).toEqual(new Uint8Array([9, 9]))
    expect(object?.contentType).toBe('image/jpeg')
    expect(sealed).toEqual(['nutrition/old.jpg'])
  })

  test('T-NUT-API-UNIT-03 a photo that cannot be read stores nothing and changes nothing', async () => {
    let revised = false
    const { service, store } = harness(
      {
        reviseMeal: async () => {
          revised = true
          return { ...row(), disposed_media_ref: null }
        },
      },
      {
        sanitize: async () => {
          throw new PhotoRejected(new Error('not an image'))
        },
      },
    )

    await expect(
      service.reviseMeal({
        ...command,
        personId: PERSON,
        mealId: MEAL,
        revision: 1,
        patch: { photo, remove_photo: false },
      }),
    ).rejects.toBeInstanceOf(PhotoRejected)
    expect(store.objects.size).toBe(0)
    expect(revised).toBe(false)
  })

  test('T-NUT-API-UNIT-04 a storage failure changes nothing either', async () => {
    let revised = false
    const { service, store } = harness({
      reviseMeal: async () => {
        revised = true
        return { ...row(), disposed_media_ref: null }
      },
    })
    store.failNext('put')

    await expect(
      service.reviseMeal({
        ...command,
        personId: PERSON,
        mealId: MEAL,
        revision: 1,
        patch: { photo, remove_photo: false },
      }),
    ).rejects.toBeDefined()
    expect(revised).toBe(false)
  })

  test('T-NUT-API-UNIT-05 a commit that fails takes the stored photo back out', async () => {
    const { service, store } = harness({
      reviseMeal: async () => {
        throw Object.assign(new Error('stale-meal'), { code: '40001' })
      },
    })

    await expect(
      service.reviseMeal({
        ...command,
        personId: PERSON,
        mealId: MEAL,
        revision: 1,
        patch: { photo, remove_photo: false },
      }),
    ).rejects.toMatchObject({ code: '40001' })
    expect(store.objects.size).toBe(0)
  })

  test('T-NUT-API-UNIT-06 removing the photo needs no storage until after the commit', async () => {
    let media: unknown
    const { service, sealed } = harness({
      reviseMeal: async (input) => {
        media = input.media
        return { ...row(), disposed_media_ref: 'nutrition/old.jpg' }
      },
    })
    await service.reviseMeal({
      ...command,
      personId: PERSON,
      mealId: MEAL,
      revision: 1,
      patch: { remove_photo: true },
    })

    expect(media).toEqual({ remove: true })
    expect(sealed).toEqual(['nutrition/old.jpg'])
  })

  test("T-NUT-API-UNIT-07 deleting removes the meal's photo from storage after the commit", async () => {
    const { service, store, sealed } = harness({
      deleteMeal: async () => ({ disposed_media_ref: 'nutrition/gone.jpg' }),
    })
    await store.put('nutrition/gone.jpg', new Uint8Array([1]), 'image/jpeg')
    await service.deleteMeal({ ...command, personId: PERSON, mealId: MEAL })

    expect(store.objects.has('nutrition/gone.jpg')).toBe(false)
    expect(sealed).toEqual(['nutrition/gone.jpg'])
  })

  test('T-NUT-API-UNIT-08 a removal storage refuses stays queued, and the answer is still yes', async () => {
    const { service, store, sealed } = harness({
      deleteMeal: async () => ({ disposed_media_ref: 'nutrition/gone.jpg' }),
    })
    store.failNext('remove')

    await expect(
      service.deleteMeal({ ...command, personId: PERSON, mealId: MEAL }),
    ).resolves.toBeUndefined()
    expect(sealed).toEqual([])
  })
})

const rice: NutritionFood = {
  id: '019f1300-0000-7000-8000-000000000201',
  name: 'Arroz blanco',
  kind: 'ingredient',
  brand: null,
  grams_per_ml: null,
  icon: 'grain',
  nutrients: [
    { nutrient_code: 'energy', value_per_100g: 130, unit: 'kcal' },
    { nutrient_code: 'protein', value_per_100g: 2.69, unit: 'g' },
  ],
  portions: [{ label: '1 taza', grams: 160, is_default: true }],
}
const ajiaco: NutritionFood = {
  ...rice,
  id: '019f1300-0000-7000-8000-000000000202',
  name: 'Ajiaco',
  kind: 'dish',
  brand: null,
  grams_per_ml: null,
}
const consented = {
  readConsent: async () => ({
    accepted_version: CURRENT_CONSENT_VERSION,
    accepted_at: '2026-10-04T12:00:00Z',
  }),
}

describe('recognising a photo (ADR-041, OP-NUT-016)', () => {
  test('T-NUT-API-UNIT-14 without consent the photo never leaves Allfit', async () => {
    const { service, recognizer } = harness({
      readConsent: async () => ({ accepted_version: null, accepted_at: null }),
    })
    expect(service.recognize({ personId: PERSON, photo, requestId: '' })).rejects.toBeInstanceOf(
      ConsentRequired,
    )
    const old = harness({
      readConsent: async () => ({
        accepted_version: '2025-01-01',
        accepted_at: '2025-01-01T00:00:00Z',
      }),
    })
    expect(
      old.service.recognize({ personId: PERSON, photo, requestId: '' }),
    ).rejects.toBeInstanceOf(ConsentRequired)
    await Promise.resolve()
    expect(recognizer.seen).toHaveLength(0)
    expect(old.recognizer.seen).toHaveLength(0)
  })

  test('T-NUT-API-UNIT-15 the photo is sanitised to 1024 px first, and nutrients come from the catalogue, never the model', async () => {
    const sizes: (number | undefined)[] = []
    const { service, recognizer } = harness(
      {
        ...consented,
        matchFoods: async ({ names }) => names.map((name) => (name === 'arroz' ? rice : null)),
      },
      { sanitize: async (_bytes, longest) => (sizes.push(longest), new Uint8Array([7])) },
    )
    recognizer.answer({
      dish: null,
      items: [{ name: 'arroz', units: 1, grams: 150, confidence: 0.9 }],
    })
    const recognition = await service.recognize({ personId: PERSON, photo, requestId: '' })

    expect(sizes).toEqual([1024])
    expect(recognizer.seen).toEqual([new Uint8Array([7])])
    expect(recognition).toEqual({
      dish: null,
      model: 'google/gemini-3.5-flash-lite',
      items: [
        {
          name: 'arroz',
          units: 1,
          grams: 150,
          confidence: 0.9,
          at: null,
          icon: null,
          estimated: false,
          needs_review: false,
          food: rice,
          nutrients: [
            { nutrient_code: 'energy', value: 195, unit: 'kcal' },
            { nutrient_code: 'protein', value: 4, unit: 'g' },
          ],
        },
      ],
    })
  })

  test('T-NUT-API-UNIT-16 an item asks for review when unsure, unmatched, or a whole dish beside its parts', async () => {
    const { service, recognizer } = harness({
      ...consented,
      matchFoods: async ({ names }) =>
        names.map((name) => (name === 'ajiaco' ? ajiaco : name === 'arroz' ? rice : null)),
    })
    recognizer.answer({
      dish: 'ajiaco',
      items: [
        { name: 'ajiaco', units: 1, grams: 300, confidence: 0.9 },
        { name: 'arroz', units: 1, grams: 50, confidence: 0.4 },
        { name: 'alcaparra', units: 8, grams: 10, confidence: 0.9 },
      ],
    })
    const recognition = await service.recognize({ personId: PERSON, photo, requestId: '' })
    expect(
      recognition.items.map((item) => [item.name, item.needs_review, item.nutrients.length]),
    ).toEqual([
      ['ajiaco', true, 2],
      ['arroz', true, 2],
      ['alcaparra', true, 0],
    ])
  })

  test('T-NUT-API-UNIT-17 a recogniser that fails fails the request, with nothing made up', async () => {
    const { service, recognizer } = harness({ ...consented, matchFoods: async () => [] })
    recognizer.failNext('unavailable')
    expect(service.recognize({ personId: PERSON, photo, requestId: '' })).rejects.toBeInstanceOf(
      RecognitionError,
    )
  })

  test('T-NUT-API-UNIT-18 the consent answers which version is current', async () => {
    const { service } = harness({
      readConsent: async () => ({ accepted_version: null, accepted_at: null }),
    })
    expect(await service.readConsent({ personId: PERSON, requestId: '' })).toEqual({
      current_version: CURRENT_CONSENT_VERSION,
      accepted_version: null,
      accepted_at: null,
    })
  })

  test("T-NUT-API-UNIT-19 the model's estimate is used only where the catalogue has no food, and says so", async () => {
    const { service, recognizer } = harness({
      ...consented,
      matchFoods: async ({ names }) => names.map((name) => (name === 'arroz' ? rice : null)),
    })
    const guess = { energy: 114, protein: 2.2, carbohydrates: 25, fat: 1 }
    recognizer.answer({
      dish: null,
      items: [
        {
          name: 'arroz',
          units: 1,
          grams: 100,
          confidence: 0.9,
          icon: 'grain',
          estimate: { ...guess, energy: 999 },
        },
        { name: 'cereal', units: 1, grams: 30, confidence: 0.8, icon: 'grain', estimate: guess },
        { name: 'cosa', units: 1, grams: 30, confidence: 0.8, icon: 'rocket' },
      ],
    })
    const [rice100, cereal, thing] = (
      await service.recognize({ personId: PERSON, photo, requestId: '' })
    ).items
    expect(rice100).toMatchObject({ estimated: false, icon: 'grain' })
    expect(rice100?.nutrients[0]).toEqual({ nutrient_code: 'energy', value: 130, unit: 'kcal' })
    expect(cereal).toMatchObject({ estimated: true, needs_review: true, food: null, icon: 'grain' })
    expect(cereal?.nutrients).toEqual([
      { nutrient_code: 'energy', value: 114, unit: 'kcal' },
      { nutrient_code: 'protein', value: 2.2, unit: 'g' },
      { nutrient_code: 'carbohydrates', value: 25, unit: 'g' },
      { nutrient_code: 'fat', value: 1, unit: 'g' },
    ])
    expect(thing).toMatchObject({ estimated: false, icon: null, nutrients: [] })
    expect(JSON.stringify(cereal)).not.toContain('estimate"')
  })

  test('T-NUT-API-UNIT-20 an estimate brings its detail, each nutrient in its own unit', async () => {
    const { service, recognizer } = harness({
      ...consented,
      matchFoods: async ({ names }) => names.map(() => null),
    })
    recognizer.answer({
      dish: null,
      items: [
        {
          name: 'cereal de chocolate',
          units: 1,
          grams: 30,
          confidence: 0.8,
          icon: 'grain',
          estimate: {
            energy: 117,
            protein: 2,
            carbohydrates: 25,
            fat: 1,
            sodium: 150.04,
            folate: 60,
          },
        },
      ],
    })
    const [cereal] = (await service.recognize({ personId: PERSON, photo, requestId: '' })).items
    expect(cereal?.nutrients).toEqual([
      { nutrient_code: 'energy', value: 117, unit: 'kcal' },
      { nutrient_code: 'protein', value: 2, unit: 'g' },
      { nutrient_code: 'carbohydrates', value: 25, unit: 'g' },
      { nutrient_code: 'fat', value: 1, unit: 'g' },
      { nutrient_code: 'sodium', value: 150, unit: 'mg' },
      { nutrient_code: 'folate', value: 60, unit: 'mcg' },
    ])
  })
})
