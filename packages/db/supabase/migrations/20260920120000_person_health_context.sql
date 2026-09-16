-- OP-IDN-008, OP-IDN-049, OP-IDN-050 and OP-SUP-003 over health context — a person's
-- declared pains, limitations and recoveries, deleting one, and support reading them
-- through a restricted window (`HU-SP-014`, `HU-SP-028`, `HU-BO-009`).
--
-- **This is not a clinical record.** V1 keeps three types, a short description in the
-- person's own words and, optionally, one body area from a closed list. There is no field
-- for a diagnosis, a test result or a document, so none can arrive by accident. A claim is
-- never rewritten: it is kept or deleted, and a later one says what changed.
--
-- **Where a claim comes from is recorded, not implied.** `identity.provenance` separates
-- the person's own word from what a professional observed or a device measured. Space
-- only ever writes `person_declared`; the other origins arrive with the flows that
-- produce them.
--
-- **Deleting is the same act for every kind of data.** The disposition that stage one
-- wrote for body progress becomes `privacy.dispose_on_owner_request`: it opens the unit
-- case under the published policy of that kind of data, records the execution, releases
-- the target and closes the case. The caller deletes its own row in the same transaction.
-- Body progress moves onto it unchanged, and health context is its second kind.
--
-- **Support reads it only through its own restricted window**, which now returns the
-- claims and refuses to be pointed at any other kind of data.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Health context
-- ---------------------------------------------------------------------------

create type identity.provenance as enum (
  'person_declared',
  'professional_observation',
  'device_observed',
  'system_inferred',
  'authority_verified'
);

create table identity.health_context_claims (
  id uuid not null,
  person_id uuid not null,
  context_type text not null,
  description text not null,
  body_area text,
  provenance identity.provenance not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_health_context_claims primary key (id),
  constraint fk_health_context_claims_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint ck_health_context_claims_type check (context_type in ('pain', 'limitation', 'recovery')),
  -- Plain words and few of them: a longer text is where a clinical history starts.
  constraint ck_health_context_claims_description check (
    btrim(description) <> '' and char_length(description) <= 500
  ),
  constraint ck_health_context_claims_area check (
    body_area is null or body_area in (
      'neck', 'shoulder', 'upper_back', 'lower_back', 'chest', 'abdomen', 'arm', 'elbow',
      'wrist_hand', 'hip', 'thigh', 'knee', 'lower_leg', 'ankle_foot'
    )
  ),
  constraint ck_health_context_claims_validity check (valid_to is null or valid_to > valid_from)
);

create index idx_health_context_claims_person
  on identity.health_context_claims (person_id, valid_from desc, id desc);

create or replace function identity.health_context_claim_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a declared health claim is never rewritten' using errcode = '55000';
end
$function$;

create trigger trg_health_context_claims_immutable
before update on identity.health_context_claims
for each row execute function identity.health_context_claim_guard_tg();

insert into privacy.retention_policies (
  data_classification_code, jurisdiction, version_number, default_action, retention_period, trigger
) values ('health', 'CO', 1, 'delete', interval '0', 'owner_request');

-- ---------------------------------------------------------------------------
-- The disposition learns a second kind of target
-- ---------------------------------------------------------------------------

alter table privacy.disposition_items add column target_health_context_id uuid;

alter table privacy.disposition_items
  add constraint fk_disposition_items_health_context foreign key (target_health_context_id) references identity.health_context_claims(id) on delete restrict;

create index idx_disposition_items_health_context
  on privacy.disposition_items (target_health_context_id);

alter table privacy.disposition_items drop constraint ck_disposition_items_target_kind;
alter table privacy.disposition_items
  add constraint ck_disposition_items_target_kind check (
    target_kind in ('body_progress', 'health_context')
  );

-- An executed deletion releases its target; anything else holds exactly one, of its kind.
alter table privacy.disposition_items drop constraint ck_disposition_items_target;
alter table privacy.disposition_items
  add constraint ck_disposition_items_target check (
    case
      when status = 'executed' and action = 'delete'
        then num_nonnulls(target_body_progress_id, target_health_context_id) = 0
      else num_nonnulls(target_body_progress_id, target_health_context_id) = 1
        and case target_kind
          when 'body_progress' then target_body_progress_id is not null
          when 'health_context' then target_health_context_id is not null
          else false
        end
    end
  );

create or replace function privacy.disposition_item_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  policy_classification text;
begin
  if tg_op = 'DELETE' then
    raise exception 'a disposition item is never deleted' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.disposition_case_id is distinct from old.disposition_case_id
       or new.subject_person_id is distinct from old.subject_person_id
       or new.data_classification_code is distinct from old.data_classification_code
       or new.retention_policy_id is distinct from old.retention_policy_id
       or new.action is distinct from old.action
       or new.target_kind is distinct from old.target_kind
       or new.due_at is distinct from old.due_at
       or new.created_at is distinct from old.created_at then
      raise exception 'a disposition item keeps what it disposes and under which policy'
        using errcode = '55000';
    end if;
    if not (
      (old.status = 'pending' and new.status in ('executed', 'suspended'))
      or (old.status = 'suspended' and new.status in ('pending', 'executed'))
    ) then
      raise exception 'a disposition moves forward, and an executed one is final'
        using errcode = '55000';
    end if;
    -- The only change a target may see is being released by its own execution.
    if (new.target_body_progress_id is distinct from old.target_body_progress_id
        and new.target_body_progress_id is not null)
       or (new.target_health_context_id is distinct from old.target_health_context_id
        and new.target_health_context_id is not null) then
      raise exception 'a disposition never changes what it targets' using errcode = '55000';
    end if;
    return new;
  end if;

  select policy.data_classification_code into policy_classification
  from privacy.retention_policies as policy
  where policy.id = new.retention_policy_id;
  if policy_classification is distinct from new.data_classification_code
     or (new.target_kind = 'body_progress' and new.data_classification_code <> 'body')
     or (new.target_kind = 'health_context' and new.data_classification_code <> 'health') then
    raise exception 'a disposition follows the policy of the data it targets' using errcode = '23514';
  end if;

  -- IX-26: the target belongs to the subject of the case.
  if (new.target_body_progress_id is not null and not exists (
        select 1 from identity.body_progress_records as record
        where record.id = new.target_body_progress_id
          and record.person_id = new.subject_person_id
      ))
     or (new.target_health_context_id is not null and not exists (
        select 1 from identity.health_context_claims as claim
        where claim.id = new.target_health_context_id
          and claim.person_id = new.subject_person_id
      )) then
    raise exception 'a disposition targets its own subject''s data' using errcode = '23514';
  end if;

  return new;
end
$function$;

-- The owner asked and the policy retains nothing, so the item is executed here and its
-- target released; the caller deletes its own row next, in the same transaction.
create or replace function privacy.dispose_on_owner_request(
  p_subject_person_id uuid,
  p_classification text,
  p_target_kind text,
  p_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  policy_id uuid;
  case_id uuid;
  item_id uuid;
begin
  select policy.id into policy_id
  from privacy.retention_policies as policy
  where policy.data_classification_code = p_classification
    and policy.jurisdiction = 'CO'
    and policy.trigger = 'owner_request'
    and policy.default_action = 'delete'
  order by policy.version_number desc
  limit 1;
  if policy_id is null then
    raise exception 'no published policy deletes this data on request' using errcode = '55000';
  end if;

  insert into privacy.disposition_cases (subject_person_id, origin, requested_by_person_id)
  values (p_subject_person_id, 'request', p_subject_person_id)
  returning id into case_id;

  insert into privacy.disposition_items (
    disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
    action, target_kind, target_body_progress_id, target_health_context_id
  ) values (
    case_id, p_subject_person_id, p_classification, policy_id, 'delete', p_target_kind,
    case when p_target_kind = 'body_progress' then p_target_id end,
    case when p_target_kind = 'health_context' then p_target_id end
  )
  returning id into item_id;

  perform system.enqueue_outbox_event(
    'disposition_case', case_id, 'privacy.disposition_case_opened.v1',
    jsonb_build_object('disposition_case_id', case_id, 'origin', 'request')
  );

  perform privacy.log_disposition_event(item_id, 'delete', 'deleted', 'owner_request');

  update privacy.disposition_items as item
  set status = 'executed',
      executed_at = clock_timestamp(),
      target_body_progress_id = null,
      target_health_context_id = null
  where item.id = item_id;

  update privacy.disposition_cases as dcase
  set status = 'closed', closed_at = clock_timestamp()
  where dcase.id = case_id;

  return case_id;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-007 — body progress moves onto the shared disposition
-- ---------------------------------------------------------------------------

create or replace function identity.delete_body_progress(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_record_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  receipt record;
  target_id uuid;
  case_id uuid;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent deletion not found' using errcode = '40001';
    end if;
    return query select jsonb_build_object(
      'body_progress_record_id', p_record_id,
      'disposition_case_id', receipt.aggregate_id,
      'status', 'deleted'
    ), true;
    return;
  end if;

  -- Someone else's record and a record that does not exist answer the same.
  select record.id into target_id
  from identity.body_progress_records as record
  where record.id = p_record_id and record.person_id = person
  for update;
  if target_id is null then
    raise exception 'measurement not found' using errcode = 'P0002';
  end if;

  case_id := privacy.dispose_on_owner_request(person, 'body', 'body_progress', target_id);
  delete from identity.body_progress_records as record where record.id = target_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'body-progress-deleted', 'disposition_case', case_id
  );
  return query select jsonb_build_object(
    'body_progress_record_id', p_record_id,
    'disposition_case_id', case_id,
    'status', 'deleted'
  ), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- What a claim looks like outside its table
-- ---------------------------------------------------------------------------

create or replace function identity.health_context_projection(p_claim_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', claim.id,
    'context_type', claim.context_type,
    'description', claim.description,
    'body_area', claim.body_area,
    'provenance', claim.provenance,
    'valid_from', claim.valid_from,
    'valid_to', claim.valid_to,
    'recorded_at', claim.created_at
  )
  from identity.health_context_claims as claim
  where claim.id = p_claim_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-008 — declare a claim
-- ---------------------------------------------------------------------------

create or replace function identity.record_health_context(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_claim_id uuid,
  p_context_type text,
  p_description text,
  p_body_area text,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  receipt record;
  words text := btrim(p_description);
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  if p_claim_id is null then
    raise exception 'a claim is identified by its command' using errcode = '22023';
  end if;
  if p_context_type is null or p_context_type not in ('pain', 'limitation', 'recovery') then
    raise exception 'V1 keeps pains, limitations and recoveries, nothing else' using errcode = '22023';
  end if;
  if words is null or words = '' or char_length(words) > 500 then
    raise exception 'a claim says something, briefly' using errcode = '22023';
  end if;
  if p_body_area is not null and p_body_area not in (
    'neck', 'shoulder', 'upper_back', 'lower_back', 'chest', 'abdomen', 'arm', 'elbow',
    'wrist_hand', 'hip', 'thigh', 'knee', 'lower_leg', 'ankle_foot'
  ) then
    raise exception 'that body area is not in the list' using errcode = '22023';
  end if;
  if p_valid_from is null
     or p_valid_from > clock_timestamp() + interval '1 day'
     or p_valid_from < timestamptz '1900-01-01 00:00:00+00' then
    raise exception 'a claim starts on a real day, not a future one' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'a claim ends after it starts' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-008', p_idempotency_key, p_claim_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent claim not found' using errcode = '40001';
    end if;
    return query select identity.health_context_projection(receipt.aggregate_id), true;
    return;
  end if;

  insert into identity.health_context_claims (
    id, person_id, context_type, description, body_area, provenance, valid_from, valid_to
  ) values (
    p_claim_id, person, p_context_type, words, p_body_area, 'person_declared',
    p_valid_from, p_valid_to
  );

  -- That a claim exists, never what it says.
  perform system.enqueue_outbox_event(
    'health_context_claim', p_claim_id, 'identity.health_context_declared.v1',
    jsonb_build_object('health_context_claim_id', p_claim_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'health-context-declared',
    'health_context_claim', p_claim_id
  );
  return query select identity.health_context_projection(p_claim_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-049 — my claims
-- ---------------------------------------------------------------------------

create or replace function identity.list_health_context(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_limit integer,
  p_before_valid_from timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  page jsonb;
  more boolean;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);
  if p_limit is null or p_limit < 1 or p_limit > 200
     or (p_before_valid_from is null) <> (p_before_id is null) then
    raise exception 'a page has a size and, after the first, a complete cursor' using errcode = '22023';
  end if;

  with ordered as (
    select claim.id,
           row_number() over (order by claim.valid_from desc, claim.id desc) as position
    from identity.health_context_claims as claim
    where claim.person_id = person
      and (
        p_before_valid_from is null
        or (claim.valid_from, claim.id) < (p_before_valid_from, p_before_id)
      )
    order by claim.valid_from desc, claim.id desc
    limit p_limit + 1
  )
  select
    coalesce(
      jsonb_agg(identity.health_context_projection(ordered.id) order by ordered.position)
        filter (where ordered.position <= p_limit),
      '[]'::jsonb
    ),
    count(*) > p_limit
  into page, more
  from ordered;

  return jsonb_build_object('items', page, 'has_more', more);
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-050 — delete a claim
-- ---------------------------------------------------------------------------

create or replace function identity.delete_health_context(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_claim_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  receipt record;
  target_id uuid;
  case_id uuid;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-050', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent deletion not found' using errcode = '40001';
    end if;
    return query select jsonb_build_object(
      'health_context_claim_id', p_claim_id,
      'disposition_case_id', receipt.aggregate_id,
      'status', 'deleted'
    ), true;
    return;
  end if;

  -- Someone else's claim and a claim that does not exist answer the same.
  select claim.id into target_id
  from identity.health_context_claims as claim
  where claim.id = p_claim_id and claim.person_id = person
  for update;
  if target_id is null then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;

  case_id := privacy.dispose_on_owner_request(person, 'health', 'health_context', target_id);
  delete from identity.health_context_claims as claim where claim.id = target_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'health-context-deleted', 'disposition_case', case_id
  );
  return query select jsonb_build_object(
    'health_context_claim_id', p_claim_id,
    'disposition_case_id', case_id,
    'status', 'deleted'
  ), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — a restricted window now reads health context too
-- ---------------------------------------------------------------------------

create or replace function support.exercise_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_category text,
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  duty_id uuid;
  file support.break_glass_requests%rowtype;
  approvals integer;
  denial text;
  event_id uuid;
  occurred timestamptz := clock_timestamp();
  readable_resource text := case p_category
    when 'body_progress' then 'identity.body_progress_records'
    when 'health_context' then 'identity.health_context_claims'
  end;
begin
  -- The only raise before the evidence is written: without a file there is
  -- nothing to attach an event to, so there is no evidence to lose.
  select * into file from support.break_glass_requests where id = p_request_id;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;

  duty_id := file.requester_duty_assignment_id;

  select count(*) into approvals
  from support.break_glass_approvals as approval
  where approval.request_id = p_request_id and approval.decision = 'approved';

  -- Each refusal carries its own reason. A category that returns content reads only its
  -- own kind of data, so a body window cannot be pointed at health claims.
  denial := case
    when file.requester_person_id <> p_actor_person_id then 'not_the_requester'
    when not access_control.has_platform_role(
      p_actor_person_id, p_actor_session_id, 'allfit_admin'
    ) or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'request_break_glass'
    ) then 'duty_not_effective'
    when support.effective_break_glass_status(
      file.status, file.request_expires_at, file.window_ends_at
    ) <> 'approved' then 'window_not_open'
    when approvals < file.required_approvals then 'quorum_incomplete'
    when not (p_category = any (file.categories)) then 'category_out_of_scope'
    when readable_resource is not null
      and p_resource_type is distinct from readable_resource then 'resource_out_of_scope'
    else null
  end;

  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode, occurred_at
  ) values (
    p_actor_person_id, file.subject_person_id, p_resource_type, p_resource_id,
    file.purpose::text, case when denial is null then 'allowed' else 'denied' end,
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'break_glass'::privacy.access_mode, occurred
  )
  returning id into event_id;

  insert into support.break_glass_events (
    request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
    category, result, resource_type, resource_id, operation_code, reason_code,
    occurred_at, access_event_id, access_event_occurred_at
  ) values (
    p_request_id, file.requester_person_id, file.requester_duty_assignment_id,
    file.subject_person_id, p_category,
    case when denial is null then 'allowed' else 'denied' end,
    p_resource_type, p_resource_id, 'OP-SUP-003',
    coalesce(denial, 'authorized_exercise'), occurred, event_id, occurred
  );

  -- Returned, never raised: the evidence above has to survive the refusal.
  if denial is not null then
    return jsonb_build_object(
      'outcome', 'denied',
      'reason_code', denial,
      'break_glass_event_id', event_id,
      'occurred_at', occurred
    );
  end if;

  if p_category = 'body_progress' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'body_progress', coalesce(
          (
            select jsonb_agg(
              identity.body_progress_projection(latest.id)
              order by latest.measured_on desc, latest.id desc
            )
            from (
              select record.id, record.measured_on
              from identity.body_progress_records as record
              where record.person_id = file.subject_person_id
              order by record.measured_on desc, record.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  if p_category = 'health_context' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'health_context', coalesce(
          (
            select jsonb_agg(
              identity.health_context_projection(latest.id)
              order by latest.valid_from desc, latest.id desc
            )
            from (
              select claim.id, claim.valid_from
              from identity.health_context_claims as claim
              where claim.person_id = file.subject_person_id
              order by claim.valid_from desc, claim.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- The categories whose data does not exist yet stay honest about it.
  return jsonb_build_object(
    'outcome', 'content_unavailable',
    'reason_code', 'execution_and_nutrition_absent',
    'break_glass_event_id', event_id,
    'occurred_at', occurred,
    'category', p_category
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- Access, ownership and grants
-- ---------------------------------------------------------------------------

alter table identity.health_context_claims enable row level security;
alter table identity.health_context_claims force row level security;

create policy health_context_claims_all_owner
  on identity.health_context_claims
  for all to allfit_owner using (true) with check (true);

alter table identity.health_context_claims owner to allfit_owner;
alter type identity.provenance owner to allfit_owner;

alter function identity.health_context_claim_guard_tg() owner to allfit_owner;
alter function privacy.disposition_item_guard_tg() owner to allfit_owner;
alter function privacy.dispose_on_owner_request(uuid, text, text, uuid) owner to allfit_owner;
alter function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function identity.health_context_projection(uuid) owner to allfit_owner;
alter function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) owner to allfit_owner;
alter function identity.list_health_context(text, text, text, integer, timestamptz, uuid)
  owner to allfit_owner;
alter function identity.delete_health_context(text, text, text, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  owner to allfit_owner;

revoke all on function identity.health_context_claim_guard_tg() from public;
revoke all on function privacy.disposition_item_guard_tg() from public;
revoke all on function privacy.dispose_on_owner_request(uuid, text, text, uuid) from public;
revoke all on function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  from public;
revoke all on function identity.health_context_projection(uuid) from public;
revoke all on function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) from public;
revoke all on function identity.list_health_context(text, text, text, integer, timestamptz, uuid)
  from public;
revoke all on function identity.delete_health_context(text, text, text, uuid, uuid, uuid, bytea)
  from public;
revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  from public;

grant execute on function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) to allfit_api;
grant execute on function identity.list_health_context(text, text, text, integer, timestamptz, uuid)
  to allfit_api;
grant execute on function identity.delete_health_context(text, text, text, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  to allfit_api;
