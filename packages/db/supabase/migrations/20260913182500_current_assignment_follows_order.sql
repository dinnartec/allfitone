-- Hoy and Entrenar have to name the same programme.
--
-- `OP-PLN-024` settles which one that is: "el primero es el programa sobre el que abre
-- la pestaña Entrenar", and `self_assign_program` honours it by inserting a new
-- assignment at `min(display_order) - 1` so taking a programme chooses it without a
-- second step.
--
-- `read_week_plan` and `read_my_programs` both read that order. This function did not:
-- it ordered by `assigned_at desc`, so it answered "the one taken most recently"
-- instead of "the one chosen". With a single assignment the two agree, which is why
-- nothing caught it — reorder your programmes and the Entrenar tab moves while the Hoy
-- screen stays on the old one, each of them certain it is right.
--
-- `lifecycle <> 'ended'` is dead today: `ck_program_assignments_personal_only` allows
-- only `personal`. It is kept because it costs nothing and stops being dead the day
-- there is a way to stop following a programme.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create or replace function planning.read_current_assignment(p_person_id uuid)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  title text,
  starts_on date,
  timezone text,
  sessions_planned integer
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         assignment.program_version_id,
         version.title,
         assignment.starts_on,
         assignment.timezone,
         (select count(*)::integer
            from planning.planned_sessions as session
           where session.assignment_id = assignment.id)
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  where assignment.person_id = p_person_id
    and assignment.lifecycle <> 'ended'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc, assignment.id desc
  limit 1
$function$;

alter function planning.read_current_assignment(uuid) owner to allfit_owner;
revoke all on function planning.read_current_assignment(uuid) from public;
grant execute on function planning.read_current_assignment(uuid) to allfit_api;

commit;
