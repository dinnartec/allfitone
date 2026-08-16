import { shutdownWorkerTelemetry } from './telemetry.js'

process.once('SIGTERM', () => {
  void shutdownWorkerTelemetry()
})

export { app, createWorkerApp, default } from './index.js'
