/*
 * `OP-PRV-022` — the words for each category of information.
 *
 * A gym member has to understand what a category covers *and what it leaves
 * out* before asking for it, and the person being asked needs the same words
 * to decide. Both read the same seven rows of `privacy.scope_presentations`,
 * which is why this is served from the tenant-less catalogue surface rather
 * than copied into Studio and Space.
 *
 * **This is not `OP-PRV-012`.** That one answers which resources and fields a
 * *published* version reaches, filtered to published versions, so it says
 * nothing until the catalogue has been curated from Backoffice. This one is
 * the vocabulary: fixed wording, no version, no publication. The distinction
 * is the story's second criterion — the definition must not move under the
 * reader's feet — and `scope_presentations` has no version column precisely so
 * that it cannot.
 *
 * Refuses a caller that is not an active person instead of answering an empty
 * list. The row-level policy on the table already admits only `person`, so a
 * Backoffice actor would otherwise read zero rows and see "there are no
 * categories" — a wrong answer that looks like a right one.
 */

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function privacy.list_information_categories()
returns table (
  scope_code text,
  display_name text,
  summary text,
  description text,
  default_purpose text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() is null then
    raise exception 'active person required' using errcode = '42501';
  end if;

  -- Both texts travel together. The summary is the line the member asking
  -- reads; the description is the fuller one, and it is the half that says
  -- where the permission stops — "No incluye…". The story asks for what each
  -- category includes *and excludes*, so returning only the summary would
  -- answer half of criterion 1.
  return query
  select presentation.scope_code,
         presentation.display_name,
         presentation.summary,
         presentation.description,
         presentation.default_purpose
  from privacy.scope_presentations as presentation
  -- The reading order of the story: training, prior history, body, health, and
  -- then the nutrition ones. An eighth code added later sorts to the end by
  -- name rather than disappearing, so a missing entry here is a cosmetic bug
  -- and never a silent omission.
  order by array_position(
             array[
               'relationship_training',
               'prior_training_history',
               'body_progress',
               'health_context',
               'nutrition_intake',
               'nutrition_media',
               'nutrition_guidance'
             ],
             presentation.scope_code
           ) nulls last,
           presentation.scope_code;
end;
$function$;

comment on function privacy.list_information_categories() is
  'OP-PRV-022: the fixed wording of each information category, for a gym member deciding what to ask for.';

alter function privacy.list_information_categories() owner to allfit_owner;
revoke all on function privacy.list_information_categories() from public;
grant execute on function privacy.list_information_categories() to allfit_api;
