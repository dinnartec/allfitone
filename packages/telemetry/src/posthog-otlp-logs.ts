import { SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs'

import { sanitizeTelemetryEvent, type TelemetryEvent } from './index.js'
import { postHogUsHost } from './posthog-host.js'

export interface OperationalLogAdapter {
  emit(kind: 'failure' | 'slow-request', event: TelemetryEvent): void
  shutdown(): Promise<void>
}

export function createPostHogOtlpLogs(options: {
  apiKey?: string | undefined
  host?: string | undefined
  immediate?: boolean
  schedule?: ((work: Promise<unknown>) => void) | undefined
  serviceName: 'allfit-api' | 'allfit-worker'
}): OperationalLogAdapter {
  const host = postHogUsHost(options.host)
  if (!options.apiKey || !host) return disabledAdapter()
  let provider: LoggerProvider
  try {
    const exporter = new OTLPLogExporter({
      url: `${host}/i/v1/logs`,
      headers: { Authorization: `Bearer ${options.apiKey}` },
    })
    const processor = options.immediate
      ? new SimpleLogRecordProcessor({ exporter })
      : new BatchLogRecordProcessor({ exporter })
    provider = new LoggerProvider({
      resource: resourceFromAttributes({ 'service.name': options.serviceName }),
      processors: [processor],
    })
  } catch {
    return disabledAdapter()
  }
  const logger = provider.getLogger(options.serviceName)

  return {
    emit(kind, event) {
      const sanitized = sanitizeTelemetryEvent(event)
      if (!sanitized) return
      try {
        logger.emit({
          severityNumber: kind === 'failure' ? SeverityNumber.ERROR : SeverityNumber.WARN,
          severityText: kind === 'failure' ? 'ERROR' : 'WARN',
          body: kind === 'failure' ? 'telemetry.failure' : 'telemetry.slow_request',
          attributes: primitiveAttributes(sanitized.properties),
        })
        if (options.immediate && options.schedule) {
          try {
            options.schedule(provider.forceFlush().catch(() => undefined))
          } catch {
            // Scheduling is provider infrastructure and cannot escape the adapter.
          }
        }
      } catch {
        // Operational logging never changes application work.
      }
    },
    async shutdown() {
      await provider.shutdown().catch(() => undefined)
    },
  }
}

function primitiveAttributes(
  properties: TelemetryEvent['properties'],
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value
    }
  }
  return attributes
}

function disabledAdapter(): OperationalLogAdapter {
  return {
    emit: () => undefined,
    shutdown: async () => undefined,
  }
}
