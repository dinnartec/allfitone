-- What I have made, for the screens that compose with it.
--
-- `E-1d`'s Rutinas tab and `PR-3`'s day sheet both ask the same question: which of my
-- routines exist, and which of them can go in a programme. Those are two different
-- answers — a draft is a routine and is not composable, because a programme points at
-- a **version** and a draft has none — so both come back in one list with the version
-- id carrying the difference.
--
-- `has_unpublished_changes` compares the draft's canonical content against the
-- published version's hash. The `derived_from_version_id` pointer looks like the right
-- answer and is not one: no Space command ever writes it, so it read `true` on every
-- published routine. Content also gets the honest answer when somebody edits a draft
-- and then puts it back the way it was.
--
-- The counts are read from the published version and not from the draft. A draft's
-- exercise count changes while somebody types, and a programme is composed of what was
-- published; showing the draft's numbers beside a version id would describe two
-- different routines with one row.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create function planning.read_my_content(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(item order by sort_key desc), '[]'::jsonb)
  from (
    select
      coalesce(published.published_at, draft.updated_at, template.created_at) as sort_key,
      jsonb_build_object(
        'template_id', template.id,
        'title', coalesce(draft.content->>'title', published.title, 'Sin nombre'),
        'discipline_code', template.discipline_code,
        'status', template.status,
        'template_version_id', published.id,
        'exercise_count', coalesce(published.exercise_count, 0),
        'set_count', coalesce(published.set_count, 0),
        -- Compared by content, not by `derived_from_version_id`: nothing in the Space
        -- write path ever sets that pointer, so it read `true` on every published
        -- routine forever. Content also answers correctly when a draft is edited back.
        'has_unpublished_changes',
          draft.id is not null
          and (
            published.content_hash is null
            or extensions.digest(
                 convert_to(planning.canonical_session_content(draft.content)::text, 'UTF8'),
                 'sha256'
               ) is distinct from published.content_hash
          )
      ) as item
    from planning.session_templates as template
    left join planning.session_template_drafts as draft on draft.template_id = template.id
    left join lateral (
      select
        version.id,
        version.published_at,
        version.title,
        version.content_hash,
        (select count(*) from planning.planned_steps as step
          where step.template_version_id = version.id) as exercise_count,
        (select coalesce(sum(target.target_sets), 0)
          from planning.planned_steps as step
          join planning.strength_targets as target on target.planned_step_id = step.id
          where step.template_version_id = version.id) as set_count
      from planning.session_template_versions as version
      where version.template_id = template.id
        and version.status = 'published'
      order by version.version_number desc
      limit 1
    ) as published on true
    where template.owner_person_id = p_person_id
  ) as mine
$function$;

alter function planning.read_my_content(uuid) owner to allfit_owner;
revoke all on function planning.read_my_content(uuid) from public;
grant execute on function planning.read_my_content(uuid) to allfit_api;

commit;
