begin;

-- `OP-PLN-030` — Consultar mi programa sin publicar.
--
-- `read_my_programs` starts from assignments, so a programme nobody published has no
-- version, no assignment, and appears in no query at all. That is what made a saved
-- programme draft unreachable: somebody armed half a week, left, came back, and the
-- screen had no way of knowing their programme existed.
--
-- The most recently touched one, and only one. Two unpublished programmes is a state
-- the product does not offer — «programa nuevo» resumes rather than starting a second
-- — so answering a list would be answering a question nobody asks.
create or replace function planning.read_my_unpublished_program(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select planning.program_projection(mine.id)
  from planning.programs as mine
  join planning.program_drafts as draft on draft.program_id = mine.id
  where mine.owner_person_id = p_person_id
    and mine.status <> 'archived'
    and not exists (
      select 1 from planning.program_versions as version where version.program_id = mine.id
    )
  order by draft.updated_at desc
  limit 1
$function$;

alter function planning.read_my_unpublished_program(uuid) owner to allfit_owner;
revoke all on function planning.read_my_unpublished_program(uuid) from public;
grant execute on function planning.read_my_unpublished_program(uuid) to allfit_api;

commit;
