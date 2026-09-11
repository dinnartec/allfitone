-- Join break-glass evidence to the person's visible audit row with a real key.
--
-- `support.break_glass_events` already carried `access_event_id` and
-- `access_event_occurred_at`, with a unique pair and a check that the two
-- timestamps match, so the two rows could not drift apart in time. But nothing
-- required the audit row to exist. Evidence could name an access event that was
-- never written, and the operator's trail would look complete while the person
-- saw nothing.
--
-- That is the wrong way round for the promise this system makes: every authorized
-- read is visible to the person it was about. The data dictionary specified this
-- foreign key; it was simply missed. `T-SUP-BG-01` was watched inserting evidence
-- against a fabricated audit identifier before this ran.
--
-- The column order is reversed against the column list because
-- `privacy.access_events` is partitioned by `occurred_at` and its primary key is
-- `(occurred_at, id)`. A composite foreign key has to name the referenced columns
-- in the order the unique declares them.

alter table support.break_glass_events
  add constraint fk_break_glass_events_access_event
  foreign key (access_event_occurred_at, access_event_id)
  references privacy.access_events (occurred_at, id) on delete restrict;
