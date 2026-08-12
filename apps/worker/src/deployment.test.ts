import { expect, test } from 'bun:test'

import config from '../vercel.json'

test('includes runtime workspace packages in the Vercel function bundle', () => {
  expect(config.functions['src/index.ts'].includeFiles).toBe(
    '../../packages/{auth-provider,notifications,queue}/**',
  )
})
