/**
 * A meal's photo goes up after the meal is saved, not before the screen lets go.
 *
 * Saving used to wait for the photo: two to three megabytes over the network, then
 * cleaned and stored, before the capture closed — and with the store unreachable, four
 * minutes. The meal is saved first and the photo follows from a queue that outlives the
 * screen. While it is on its way the diary shows the photo from the phone; a photo that
 * still fails after its retries is said so, and can be sent again.
 */

import { describe, expect, test } from 'bun:test'

import { createPhotoUploads } from './photo-uploads'

const photo = { uri: 'file:///plate.jpg', base64: 'AAAA' }

function harness(outcomes: readonly ('ok' | 'fail')[]) {
  const sent: string[] = []
  let call = 0
  const uploads = createPhotoUploads({
    upload: async (mealId) => {
      sent.push(mealId)
      const outcome = outcomes[Math.min(call, outcomes.length - 1)]
      call += 1
      if (outcome === 'fail') throw new Error('store down')
    },
    wait: async () => undefined,
  })
  return { uploads, sent }
}

describe('the photo upload queue', () => {
  test('T-SPC-UNIT-280 a photo is shown from the phone while it goes up, and let go once it is stored', async () => {
    const { uploads, sent } = harness(['ok'])
    const done = uploads.enqueue('meal-1', photo)
    expect(uploads.stateOf('meal-1')).toEqual({ kind: 'uploading', uri: photo.uri })
    await done
    expect(sent).toEqual(['meal-1'])
    expect(uploads.stateOf('meal-1')).toBeNull()
  })

  test('T-SPC-UNIT-281 a failed upload is retried, and said to have failed only after its last try', async () => {
    const { uploads, sent } = harness(['fail', 'fail', 'fail'])
    await uploads.enqueue('meal-1', photo)
    expect(sent).toEqual(['meal-1', 'meal-1', 'meal-1'])
    expect(uploads.stateOf('meal-1')).toEqual({ kind: 'failed', uri: photo.uri })

    const second = harness(['fail', 'ok'])
    await second.uploads.enqueue('meal-2', photo)
    expect(second.sent).toEqual(['meal-2', 'meal-2'])
    expect(second.uploads.stateOf('meal-2')).toBeNull()
  })

  test('T-SPC-UNIT-282 a failed photo can be sent again, and whoever watches hears every change', async () => {
    const { uploads } = harness(['fail', 'fail', 'fail', 'ok'])
    const heard: (string | null)[] = []
    const stop = uploads.subscribe(() => heard.push(uploads.stateOf('meal-1')?.kind ?? null))
    await uploads.enqueue('meal-1', photo)
    expect(uploads.stateOf('meal-1')?.kind).toBe('failed')
    await uploads.retry('meal-1')
    expect(uploads.stateOf('meal-1')).toBeNull()
    expect(heard).toEqual(['uploading', 'failed', 'uploading', null])
    stop()
  })

  test('T-SPC-UNIT-283 retrying a photo that is not failed does nothing', async () => {
    const { uploads, sent } = harness(['ok'])
    await uploads.retry('nothing')
    expect(sent).toEqual([])
  })
})
