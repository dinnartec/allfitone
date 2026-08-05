# Consumers

One per outbox event. Each one unpacks, calls the use case, acknowledges.

They must be **idempotent**: delivery is at-least-once, so the same message can
arrive twice.

First to implement: `contact-change` — calls the provider's email update, then
promotes the pending email to effective. If it fails after retries, the pending
value is discarded; the effective email never moved.
