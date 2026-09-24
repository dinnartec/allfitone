/**
 * `T-SP-QUEUE-01..04` — saves that take their turn instead of racing.
 *
 * The case this exists for is the last one. A draft save answers with the etag the
 * next save must send, so two in flight at once means the second carries an etag the
 * first is replacing — and the server refuses it. Pressing «guardar» within the
 * autosave's delay is exactly that, and it was reported as «no pudimos guardar».
 */

import { describe, expect, test } from 'bun:test'

import { createQueue } from './queue'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('work that takes its turn', () => {
  test('T-SP-QUEUE-01 runs in the order it was asked for', async () => {
    const queue = createQueue()
    const order: number[] = []

    const all = [1, 2, 3].map((at) =>
      queue(async () => {
        await settle()
        order.push(at)
      }),
    )
    await Promise.all(all)

    expect(order).toEqual([1, 2, 3])
  })

  test('T-SP-QUEUE-02 never has two pieces of work in flight at once', async () => {
    const queue = createQueue()
    let running = 0
    let most = 0

    await Promise.all(
      [1, 2, 3].map(() =>
        queue(async () => {
          running += 1
          most = Math.max(most, running)
          await settle()
          running -= 1
        }),
      ),
    )

    expect(most).toBe(1)
  })

  test('T-SP-QUEUE-03 the caller sees the real failure', async () => {
    const queue = createQueue()

    expect(
      queue(async () => {
        throw new Error('refused')
      }),
    ).rejects.toThrow('refused')
  })

  test('T-SP-QUEUE-04 a failure does not stop what comes after it', async () => {
    // An editor whose save failed once must still be able to try again; a queue that
    // stopped at the first error would be an editor that silently stopped saving.
    const queue = createQueue()
    queue(async () => {
      throw new Error('refused')
    }).catch(() => undefined)

    expect(await queue(async () => 'saved')).toBe('saved')
  })
})
