/**
 * A workspace package the function imports has to travel with it. Vercel ships
 * what `includeFiles` names and nothing else, so a dependency missing from that
 * list is `ERR_MODULE_NOT_FOUND` at import — which takes down every route, not
 * the one that needed it.
 *
 * This asserts the rule rather than the string it currently produces. The
 * earlier version copied the value, so it failed whenever the list changed and
 * never said whether the list was right; the API had no equivalent at all, and
 * that is the gap the outage of 2026-10-14 came through.
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
