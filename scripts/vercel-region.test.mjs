import { describe, expect, test } from 'bun:test'

import { vercelExecutionRegion } from './vercel-region.mjs'

describe('vercelExecutionRegion', () => {
  test('reads the function region after a different edge region', () => {
    expect(vercelExecutionRegion('iad1::pdx1::request-id')).toBe('pdx1')
  })

  test('reads the function region when edge and function share one segment', () => {
    expect(vercelExecutionRegion('pdx1::request-id')).toBe('pdx1')
  })

  test('uses the last region when the request crossed multiple regions', () => {
    expect(vercelExecutionRegion('cle1::iad1::pdx1::request-id')).toBe('pdx1')
  })

  test('returns undefined when the header is absent or malformed', () => {
    expect(vercelExecutionRegion(null)).toBeUndefined()
    expect(vercelExecutionRegion('request-id')).toBeUndefined()
  })
})
