import { describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'

import type { BodyPhotoService } from '../application/body-photos.js'
import type { SpaceActorResolver } from '../application/space-actor.js'
import type { BodyPhoto } from '../domain/body-photos.js'
import { spaceBodyPhotoRoutes } from './space-body-photos.js'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const PHOTO = '019f1000-0000-7000-8000-0000000000c1'
const kept: BodyPhoto = {
  id: PHOTO,
  taken_on: '2026-10-25',
  created_at: '2026-10-25T12:00:00.000Z',
  photo: { url: 'https://objects.test/x', expires_at: '2026-10-25T12:05:00.000Z', method: 'GET' },
}
const commanded = {
  authorization: 'Bearer token',
  'content-type': 'application/json',
  'idempotency-key': '2b4f0d4e-2f3c-4c1d-9a4b-6f1e2d3c4b5a',
  'command-id': PHOTO,
}
const body = JSON.stringify({
  taken_on: '2026-10-25',
  photo: { content_type: 'image/jpeg', content: Buffer.from([1, 2, 3]).toString('base64') },
})

const token: VerifiedToken = { subject: 'subject', sessionId: 'sid', surface: 'space' }

function harness(service: Partial<BodyPhotoService> = {}) {
  const actors: SpaceActorResolver = {
    actorFor: async () => ({ accountId: 'account', personId: PERSON }),
    personFor: async () => PERSON,
  }
  return spaceBodyPhotoRoutes(
    {
      record: async () => kept,
      list: async () => ({ data: [kept] }),
      delete: async () => undefined,
      ...service,
    },
    async () => token,
    actors,
  )
}

describe('/space/v1/body-photos', () => {
  test('T-IDN-API-BODYPHOTO-10 keeps a photo and answers it signed', async () => {
    const response = await harness().request('/body-photos', {
      method: 'POST',
      headers: commanded,
      body,
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(kept)
  })

  test('T-IDN-API-BODYPHOTO-11 a plan without photos says which function it lacks', async () => {
    const refused = harness({
      record: async () => {
        throw Object.assign(new Error('this function comes with Pro'), {
          code: 'AF402',
          detail: 'body_photos',
        })
      },
    })
    const response = await refused.request('/body-photos', {
      method: 'POST',
      headers: commanded,
      body,
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ feature: 'body_photos' })
  })

  test('T-IDN-API-BODYPHOTO-12 refuses a body outside the contract', async () => {
    for (const wrong of [
      JSON.stringify({ taken_on: '2026-10-25' }),
      JSON.stringify({
        taken_on: '2026-02-30',
        photo: { content_type: 'image/jpeg', content: 'AQID' },
      }),
      JSON.stringify({
        taken_on: '2026-10-25',
        photo: { content_type: 'image/gif', content: 'AQID' },
      }),
      JSON.stringify({
        taken_on: '2026-10-25',
        photo: { content_type: 'image/jpeg', content: 'AQID' },
        x: 1,
      }),
    ]) {
      const response = await harness().request('/body-photos', {
        method: 'POST',
        headers: commanded,
        body: wrong,
      })
      expect(response.status).toBe(400)
    }
  })

  test("T-IDN-API-BODYPHOTO-13 lists the person's photos", async () => {
    const response = await harness().request('/body-photos', {
      headers: { authorization: 'Bearer token' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [kept] })
  })

  test('T-IDN-API-BODYPHOTO-14 deletes one, and refuses an identifier that is not one', async () => {
    const gone = await harness().request(`/body-photos/${PHOTO}`, {
      method: 'DELETE',
      headers: commanded,
    })
    const wrong = await harness().request('/body-photos/nope', {
      method: 'DELETE',
      headers: commanded,
    })
    expect(gone.status).toBe(204)
    expect(wrong.status).toBe(400)
  })

  test('T-IDN-API-BODYPHOTO-15 nothing without a bearer token', async () => {
    const response = await harness().request('/body-photos', {})
    expect(response.status).toBe(401)
  })
})
