/**
 * Entry point in a container (Railway, Fly, ECS, k8s).
 *
 * Exists from day one even though it is unused: it is the proof that the app does
 * not depend on the hosting provider. Migrating means changing the pipeline, not
 * the code.
 */
import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 8080)

serve({ fetch: createApp().fetch, port })
console.log(`API listening on :${port}`)
