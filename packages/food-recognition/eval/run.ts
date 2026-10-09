/**
 * The recognition eval (ADR-041): every photo of `photos.json` through the real adapter,
 * scored against what a person sees in it. A model only replaces the current one when it
 * passes: at least 85 % of the expected foods named, and no answer that is just the dish.
 * It costs money, so it runs by hand, never in CI.
 *
 * Run: `bun run eval [model …]` (the pinned model by default).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { createGatewayRecognizer } from '../src/adapters/gateway.js'
import { DEFAULT_MODEL } from '../src/factory.js'

interface Photo {
  readonly key: string
  readonly url: string
  readonly expected: readonly string[]
}

const here = (name: string) => new URL(name, import.meta.url).pathname
const { photos } = JSON.parse(readFileSync(here('photos.json'), 'utf8')) as { photos: Photo[] }
const apiKey = process.env.AI_GATEWAY_API_KEY
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not set')

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function image(photo: Photo): Promise<Uint8Array> {
  mkdirSync(here('.cache'), { recursive: true })
  const path = here(`.cache/${photo.key}.jpg`)
  if (!existsSync(path)) {
    const response = await fetch(photo.url, {
      headers: { 'user-agent': 'AllfitEval/1.0 (internal test)' },
    })
    if (!response.ok) throw new Error(`could not download ${photo.key}: ${String(response.status)}`)
    writeFileSync(path, new Uint8Array(await response.arrayBuffer()))
  }
  return new Uint8Array(readFileSync(path))
}

const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [DEFAULT_MODEL]
let failed = false
for (const model of models) {
  const recognizer = createGatewayRecognizer({ apiKey, model, timeoutMs: 60_000 })
  const scores = await Promise.all(
    photos.map(async (photo) => {
      const started = performance.now()
      try {
        const answer = await recognizer.recognize(await image(photo))
        const names = answer.items.map((item) => fold(item.name))
        const hits = photo.expected.filter((pattern) =>
          names.some((name) => new RegExp(pattern).test(name)),
        )
        return {
          photo: photo.key,
          recall: hits.length / photo.expected.length,
          collapsed: answer.items.length === 1 && photo.expected.length > 1,
          ms: performance.now() - started,
          error: null,
        }
      } catch (cause) {
        return {
          photo: photo.key,
          recall: 0,
          collapsed: false,
          ms: performance.now() - started,
          error: cause instanceof Error ? cause.message : String(cause),
        }
      }
    }),
  )
  const recall = scores.reduce((sum, score) => sum + score.recall, 0) / scores.length
  const collapsed = scores.filter((score) => score.collapsed).length
  const errors = scores.filter((score) => score.error)
  const sorted = scores.map((score) => score.ms).sort((a, b) => a - b)
  const passes = recall >= 0.85 && collapsed === 0 && errors.length === 0
  failed ||= !passes
  console.log(
    `${model}: ${passes ? 'PASA' : 'NO PASA'} · aciertos ${(recall * 100).toFixed(0)} % · solo el plato ${String(collapsed)} · errores ${String(errors.length)} · mediana ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(0)} ms`,
  )
  for (const score of scores.filter((one) => one.recall < 1 || one.error)) {
    console.log(
      `   ${score.photo}: ${(score.recall * 100).toFixed(0)} %${score.error ? ` · ${score.error}` : ''}`,
    )
  }
}
process.exit(failed ? 1 : 0)
