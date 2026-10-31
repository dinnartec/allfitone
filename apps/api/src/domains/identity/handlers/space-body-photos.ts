/**
 * Body photo routes on /space/v1: `OP-IDN-056`, `OP-IDN-057` and `OP-IDN-058`.
 *
 * `HU-SP-025..027`. The token is verified and resolved to a person; nothing in a request
 * can name whose photos these are. Structure is checked here and answers 400; a photo
 * that is not one is the sanitiser's to refuse (422), and a plan that does not keep
 * photos answers `plan-limit-reached` naming `body_photos`.
 */

import { ObjectStoreError } from '@allfitone/object-store'
import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import { PhotoRejected } from '../../../platform/media/photo.js'
import {
  exactObject,
  isCalendarDate,
  isJsonRequest,
  readJson,
  spaceCommand,
  spaceFailure,
  spaceTokenVerifier,
  verifiedSpaceToken,
  type TokenVerifier,
} from '../../../platform/http/space-requests.js'
import type { BodyPhotoService } from '../application/body-photos.js'
import { SpaceActorError, type SpaceActorResolver } from '../application/space-actor.js'
import { spaceActorResolver, spaceBodyPhotoService } from '../dependencies.js'
import type { BodyPhotoUpload } from '../domain/body-photos.js'

const OPERATION = 'space-body-photos'
const MAX_PHOTO = 14_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function spaceBodyPhotoRoutes(
  injectedService?: BodyPhotoService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const photos = () => injectedService ?? spaceBodyPhotoService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  routes.get('/body-photos', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    try {
      const personId = await actors().personFor(String(token.subject))
      return c.json(
        await photos().list({ personId, requestId: c.req.header('x-request-id') ?? '' }),
      )
    } catch (error) {
      return failure(c, error)
    }
  })

  routes.post('/body-photos', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const body = await readJson(c)
    const upload = readUpload(body)
    const command = spaceCommand(c, body)
    if (!upload || !command) return problem(c, 'invalid-request')

    try {
      const personId = await actors().personFor(String(token.subject))
      const kept = await photos().record({ personId, ...upload, ...command })
      return c.json(kept, 201)
    } catch (error) {
      return failure(c, error)
    }
  })

  routes.delete('/body-photos/:photoId', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const photoId = c.req.param('photoId')
    const command = spaceCommand(c, { photoId })
    if (!UUID.test(photoId) || !command) return problem(c, 'invalid-request')

    try {
      const personId = await actors().personFor(String(token.subject))
      await photos().delete({ personId, photoId, ...command })
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  return routes
}

function readUpload(body: unknown): { takenOn: string; photo: BodyPhotoUpload } | undefined {
  const fields = exactObject(body, ['taken_on', 'photo'])
  if (!fields || typeof fields.taken_on !== 'string' || !isCalendarDate(fields.taken_on)) {
    return undefined
  }
  const photo = exactObject(fields.photo, ['content_type', 'content'])
  if (!photo || typeof photo.content !== 'string' || photo.content.length > MAX_PHOTO)
    return undefined
  const contentType = photo.content_type
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') {
    return undefined
  }
  return { takenOn: fields.taken_on, photo: { content_type: contentType, content: photo.content } }
}

function failure(c: Context, error: unknown) {
  if (error instanceof SpaceActorError) return problem(c, 'registration-incomplete')
  if (error instanceof PhotoRejected)
    return problem(c, 'validation-failed', 'The photo could not be read')
  if (error instanceof ObjectStoreError) return problem(c, 'upstream-unavailable')
  return spaceFailure(c, error, OPERATION)
}
