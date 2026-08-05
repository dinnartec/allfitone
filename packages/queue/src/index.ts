export type { Queue, QueueMessage } from './port.js'

// Default adapter: the queue lives on `system.outbox_events` in the same
// PostgreSQL. No provider dependency and no hosting lock-in.
// An SQS/SNS adapter would go here the day there is a measured reason for one.
export { createPostgresQueue } from './adapters/postgres.js'
