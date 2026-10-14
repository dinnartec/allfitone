/**
 * The API had no test like the worker's, and that is the gap the outage of
 * 2026-10-14 came through: `@allfitone/food-recognition` joined the API's
 * dependencies on 5 October, never joined `includeFiles`, and the function
 * answered `500` on every path — including `/` — because the failure happens at
 * import rather than on a route.
 *
 * Vercel ships what `includeFiles` names and nothing else.
 */
import { expect, test } from 'bun:test'

import manifest from '../package.json'
import config from '../vercel.json'

test('ships every workspace package it depends on', () => {
  const included = config.functions['src/index.ts']?.includeFiles ?? ''
  const named = included.match(/\{([^}]*)\}/)?.[1]?.split(',') ?? []

  const dependencies = Object.keys(manifest.dependencies)
    .filter((name) => name.startsWith('@allfitone/'))
    .map((name) => name.slice('@allfitone/'.length))

  expect([...dependencies].sort()).toEqual([...named].sort())
})
