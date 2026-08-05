# Scheduled jobs

Backed by `system.job_runs`.

- Outbox sweep: picks up anything left behind by a failed delivery.
- Expiry of time-bounded platform authority.
