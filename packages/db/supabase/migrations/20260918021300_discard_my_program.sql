-- `OP-PLN-029` — Descartar un programa propio.
--
-- The twin of `OP-PLN-028`, and it exists for the same reason that one did: a
-- programme somebody starts and abandons is orphaned. It exists, it counts against
-- them, and nothing in the product can reach it again — the list of programmes only
-- carries the ones with a published version, so a draft that never got there is
-- invisible and permanent at once.
--
-- **It is a state, not a deletion.** `allfit_api` has no `DELETE` on this resource and
-- is not getting one: what a person wrote is not destroyed from the runtime, and a
-- discard has to be explicable afterwards.
--
-- **A published programme is refused.** Assignments reference its version and sessions
-- have been materialised against it, so archiving the programme would leave somebody
-- training from something that officially no longer exists. Retiring a version from
-- new uses is a different act with its own operation.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create or replace function planning.discard_my_program(
  p_person_id uuid,
  p_program_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (program jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.programs%rowtype;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-029', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into current
  from planning.programs as owned
  where owned.id = p_program_id and owned.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;

  -- Assignments point at the version and sessions are materialised from it. Archiving
  -- the programme under them would leave somebody training from something that is
  -- officially gone.
  if exists (
    select 1 from planning.program_versions as version
    where version.program_id = p_program_id
  ) then
    raise exception 'program has published versions' using errcode = '23514';
  end if;

  -- Discarding twice converges rather than failing: the second call finds it already
  -- archived and answers the same programme.
  if current.status <> 'archived' then
    update planning.programs
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_program_id;

    delete from planning.program_drafts where program_id = p_program_id;

    perform system.enqueue_outbox_event(
      'program', p_program_id, 'planning.program_discarded.v1',
      jsonb_build_object('program_id', p_program_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-discarded', 'program', p_program_id
  );
  return query select planning.program_projection(p_program_id), false;
end
$function$;

alter function planning.discard_my_program(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.discard_my_program(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function planning.discard_my_program(uuid, uuid, uuid, uuid, bytea) to allfit_api;

commit;
