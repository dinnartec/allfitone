/**
 * Local entry point.
 *
 * The worker is cron-invoked in production and needs no port there, but `bun run dev`
 * serves whatever a module default-exports. Without a port of its own it takes `PORT` —
 * the API's — and the second process to start dies with "port in use". Hence
 * `WORKER_PORT`, defaulted so nobody has to set it.
 */

import { app, createWorkerApp } from './index.js'
import { shutdownWorkerTelemetry } from './telemetry.js'

process.once('SIGTERM', () => {
  void shutdownWorkerTelemetry()
})

export { app, createWorkerApp }

export default {
  port: Number(process.env.WORKER_PORT ?? 8090),
  fetch: app.fetch,
}
