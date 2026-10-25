/**
 * The native half of «Cuerpo»: measurements and photos, behind the same refresh the
 * other flows use. Every write is a command with its own key, so a retry after a lost
 * answer replays the record instead of writing it twice.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import type { BodyDeclaration, BodyPage, BodyPhoto, BodyPhotoPage, BodyRecord } from './body'
import { authorizedGet, authorizedPost, authorizedSend } from './index'
import { authenticated } from './session'

const PAGE = 200
/** A year of weekly weigh-ins and monthly measures fits in a few pages; more is not drawn. */
const MOST_PAGES = 5

const command = () =>
  newCommand(
    { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
    Date.now(),
  )

export async function readBodyRecords(): Promise<BodyRecord[]> {
  const all: BodyRecord[] = []
  let cursor = ''
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const read = await authenticated((token) =>
      authorizedGet<BodyPage>(`/space/v1/body-progress?limit=${String(PAGE)}${cursor}`, token),
    )
    all.push(...read.items)
    const last = read.items.at(-1)
    if (!read.has_more || !last) break
    cursor = `&before_measured_on=${last.measured_on}&before_id=${last.id}`
  }
  return all
}

export function recordBodyMeasure(declaration: BodyDeclaration): Promise<unknown> {
  const headers = command()
  return authenticated((token) =>
    authorizedPost('/space/v1/body-progress', headers, declaration, token),
  )
}

export async function readBodyPhotos(): Promise<BodyPhoto[]> {
  const read = await authenticated((token) =>
    authorizedGet<BodyPhotoPage>('/space/v1/body-photos', token),
  )
  return read.data
}

export function recordBodyPhoto(takenOn: string, base64: string): Promise<BodyPhoto> {
  const headers = command()
  return authenticated((token) =>
    authorizedPost<BodyPhoto>(
      '/space/v1/body-photos',
      headers,
      { taken_on: takenOn, photo: { content_type: 'image/jpeg', content: base64 } },
      token,
    ),
  )
}

export function deleteBodyPhoto(photoId: string): Promise<undefined> {
  const headers = command()
  return authenticated((token) =>
    authorizedSend<undefined>(
      'DELETE',
      `/space/v1/body-photos/${photoId}`,
      headers,
      undefined,
      token,
    ),
  )
}
