import { expect, test } from 'bun:test'

import { newCommand } from './studio-api.js'

test('uses UUIDv4 for HTTP idempotency and UUIDv7 for durable command identity', () => {
  const command = newCommand()
  expect(command.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(command.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})
