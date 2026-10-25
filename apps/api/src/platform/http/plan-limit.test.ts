import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { failPlanLimit, planLimitFeature } from './index.js'
import { spaceFailure } from './space-requests.js'

/** What postgres.js throws when a function raises AF402 with the function in the detail. */
const refusal = (detail: unknown) =>
  Object.assign(new Error('the plan reached its limit'), { code: 'AF402', detail })

describe('planLimitFeature', () => {
  test('reads the function a plan refused', () => {
    expect(planLimitFeature(refusal('own_routines'))).toBe('own_routines')
  })

  test('nothing for any other refusal', () => {
    expect(
      planLimitFeature(Object.assign(new Error('x'), { code: '23514', detail: 'own_routines' })),
    ).toBeUndefined()
    expect(planLimitFeature(new Error('x'))).toBeUndefined()
    expect(planLimitFeature(null)).toBeUndefined()
  })

  test('nothing when the detail is not a function code', () => {
    expect(planLimitFeature(refusal('DROP TABLE'))).toBeUndefined()
    expect(planLimitFeature(refusal(42))).toBeUndefined()
  })
})

describe('the answer', () => {
  test('the problem says which function the plan does not open', async () => {
    const app = new Hono().get('/', (c) => failPlanLimit(c, 'routine_duplication'))
    const response = await app.request('/')
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: 'https://errors.allfit.invalid/plan-limit-reached',
      status: 403,
      feature: 'routine_duplication',
    })
  })

  test('and so does every Space route that maps database verdicts', async () => {
    const app = new Hono().get('/', (c) => spaceFailure(c, refusal('body_photos'), 'test'))
    const response = await app.request('/')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      type: 'https://errors.allfit.invalid/plan-limit-reached',
      feature: 'body_photos',
    })
  })
})
