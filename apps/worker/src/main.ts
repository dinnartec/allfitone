/**
 * Worker: consumes the outbox and runs scheduled jobs.
 *
 * Consumers are deliberately thin: they unpack the message and call a use case
 * from apps/api. Logic does not live here, so changing queue mechanism means
 * rewriting wrappers rather than rules.
 *
 * On serverless this is cron-invoked; in a container it runs as a loop. Same
 * logic, different trigger.
 */
export {}
