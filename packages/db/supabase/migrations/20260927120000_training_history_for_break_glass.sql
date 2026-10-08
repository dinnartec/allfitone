-- The training a break-glass window returns — `OP-SUP-003`, `HU-BO-008`.
--
-- This file used to create the `execution` slice as well. It no longer does: the
-- Space app landed the same tables first, from the same data dictionary, so what
-- was a slice here is now two functions over somebody else's tables.
--
-- What stayed is the part nobody else had: a projection of one session that does
-- not belong to the person reading it, and the break-glass category that returns
-- it. `execution.read_execution` cannot serve this — it answers for the session's
-- owner and carries their programme context, which is exactly what a support read
-- must not do.
--
-- Free sessions (`OP-EXE-004`, `OP-EXE-014`) are not here either. Starting a
-- session without a plan is a Space story on a slice Space now owns, and building
-- it twice is how two answers to the same question end up in one database.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- One session, as somebody who is not its owner may be shown it
-- ---------------------------------------------------------------------------

create or replace function execution.session_projection(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'activity_type_code', activity.code,
    'activity_type_name', activity.name,
    'discipline_code', activity.discipline_code,
    'started_at', session.started_at,
    'ended_at', session.ended_at,
    'timezone', session.timezone,
    'status', session.execution_status,
    'validation_status', session.validation_status,
    'requested_level', session.requested_level,
    'achieved_level', session.achieved_level,
    'revision_number', session.revision_number,
    'capture_source', session.capture_source,
    'contract', jsonb_build_object(
      'id', session.result_contract_id, 'version', session.contract_version
    ),
    'segments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('position', segment.position, 'activity_type_code', kind.code)
          order by segment.position
        )
        from execution.session_segments as segment
        left join catalog.activity_types as kind on kind.id = segment.activity_type_id
        where segment.executed_session_id = session.id
      ),
      '[]'::jsonb
    ),
    'strength_sets', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'segment_position', segment.position,
            'order', result.set_order,
            'movement_id', result.movement_id,
            'movement_name', movement.name,
            'achieved_reps', result.achieved_reps,
            'load', case
              when result.original_load_value is not null then jsonb_build_object(
                'value', result.original_load_value, 'unit', result.original_load_unit_code
              )
              when result.load_value is not null then jsonb_build_object(
                'value', result.load_value, 'unit', result.load_unit_code
              )
            end,
            'rpe', result.rpe
          )
          order by result.set_order
        )
        from execution.strength_sets as result
        left join execution.session_segments as segment on segment.id = result.session_segment_id
        left join catalog.movements as movement on movement.id = result.movement_id
        where result.executed_session_id = session.id
      ),
      '[]'::jsonb
    ),
    'endurance_laps', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'segment_position', segment.position,
            'lap_number', lap.lap_number,
            'distance', jsonb_build_object(
              -- A lap keeps no original pair the way a set does, so what was stored
              -- is what the person entered.
              'value', lap.distance_value,
              'unit', lap.distance_unit_code
            ),
            'duration_seconds', lap.duration_seconds
          )
          order by lap.lap_number
        )
        from execution.endurance_laps as lap
        left join execution.session_segments as segment on segment.id = lap.session_segment_id
        where lap.executed_session_id = session.id
      ),
      '[]'::jsonb
    )
  )
  from execution.executed_sessions as session
  join catalog.activity_types as activity on activity.id = session.activity_type_id
  where session.id = p_session_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — the training category
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
    when 'nutrition_intake' then 'nutrition.meals'
    when 'prior_training_history' then 'execution.executed_sessions'
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
  -- own kind of data, so a training window cannot be pointed at meals.
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

  if p_category = 'nutrition_intake' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'nutrition_intake', coalesce(
          (
            select jsonb_agg(
              nutrition.meal_projection(latest.id)
              order by latest.occurred_at desc, latest.id desc
            )
            from (
              select meal.id, meal.occurred_at
              from nutrition.meals as meal
              where meal.person_id = file.subject_person_id
              order by meal.occurred_at desc, meal.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- Autonomous sessions are the person's prior training history.
  if p_category = 'prior_training_history' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'prior_training_history', coalesce(
          (
            select jsonb_agg(
              execution.session_projection(latest.id)
              order by latest.started_at desc, latest.id desc
            )
            from (
              select session.id, session.started_at
              from execution.executed_sessions as session
              where session.person_id = file.subject_person_id and session.is_autonomous
              order by session.started_at desc, session.id desc
              limit 100
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- Relationship training and nutrition guidance have no data in the platform yet.
  return jsonb_build_object(
    'outcome', 'content_unavailable',
    'reason_code', 'category_content_absent',
    'break_glass_event_id', event_id,
    'occurred_at', occurred,
    'category', p_category
  );
end
$function$;

alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  owner to allfit_owner;

revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  from public;

grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  to allfit_api;
