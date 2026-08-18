/**
 * Reading a response that may legitimately carry nothing.
 *
 * `POST /space/v1/auth/password-resets` answers `202` with an empty body on
 * purpose: anything it returned would describe what happened, and not describing
 * it is the point. The client parsed every successful response as JSON, so that
 * empty body threw and the sheet reported "we could not connect" for a request
 * that had in fact arrived and sent the mail.
 *
 * Observed on device before this existed.
 */

import { describe, expect, test } from 'bun:test'

import { readJsonBody } from './response'

const responding = (status: number, body: string) => ({
  status,
  text: async () => body,
})

describe('readJsonBody', () => {
  test('returns nothing for an accepted request that carries no body', async () => {
    await expect(readJsonBody(responding(202, ''))).resolves.toBeUndefined()
  })

  test('returns nothing for 204, which cannot have a body at all', async () => {
    await expect(readJsonBody(responding(204, ''))).resolves.toBeUndefined()
  })

  test('treats whitespace as empty rather than as broken JSON', async () => {
    await expect(readJsonBody(responding(202, '  \n '))).resolves.toBeUndefined()
  })

  test('parses a body when there is one', async () => {
    await expect(readJsonBody(responding(200, '{"accessToken":"at_1"}'))).resolves.toEqual({
      accessToken: 'at_1',
    })
  })

  test('still throws on a body that claims to be JSON and is not', async () => {
    // A malformed payload is a real fault and must not be silently read as
    // "nothing came back".
    await expect(readJsonBody(responding(200, '{roto'))).rejects.toThrow()
  })
})
