import type { CommandHeaders } from './studio-api.js'

export interface CommandIntentRequest {
  operation: string
  resourceId: string | null
  payload: unknown
}

export interface CommandIntentManager {
  commandFor: (request: CommandIntentRequest) => CommandHeaders
  reset: () => void
}

export function createCommandIntentManager(
  createCommand: () => CommandHeaders,
): CommandIntentManager {
  let currentKey: string | undefined
  let currentCommand: CommandHeaders | undefined

  return {
    commandFor(request) {
      const nextKey = stableSerialize([request.operation, request.resourceId, request.payload])
      if (!currentCommand || currentKey !== nextKey) {
        currentKey = nextKey
        currentCommand = createCommand()
      }
      return currentCommand
    },
    reset() {
      currentKey = undefined
      currentCommand = undefined
    },
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  return serialized ?? 'null'
}
