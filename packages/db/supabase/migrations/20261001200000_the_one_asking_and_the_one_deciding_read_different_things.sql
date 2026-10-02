-- The professional asking and the person deciding do not need the same words.
--
-- `scope_presentations.description` says what a permission covers and where it
-- stops — three or four lines, written for somebody deciding whether to hand
-- over their injuries or their measurements. That is the right text for them,
-- and the wrong one for the invite form: seven permissions, each with that
-- paragraph, is a wall nobody reads, and a professional who reads nothing picks
-- blind.
--
-- So the catalogue carries both. `summary` is one line for the person building
-- the invitation; `description` stays whole for the person answering it.
--
-- The summary keeps the boundary rather than dropping it. "Medidas y fotos que
-- elija" invites asking for `body_progress` and hoping it covers health; "sin
-- datos de salud" is what stops that, and it is the half most worth keeping
-- when there is only one line to spend.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table privacy.scope_presentations
  add column summary text,
  add constraint ck_scope_presentations_summary check (summary is null or (btrim(summary) <> '' and char_length(summary) <= 120));

update privacy.scope_presentations set summary = 'Sesiones que le asignes y sus resultados, nada de lo que entrene por su cuenta.'
  where scope_code = 'relationship_training';
update privacy.scope_presentations set summary = 'Entrenamientos anteriores y por su cuenta, sin cuerpo ni salud.'
  where scope_code = 'prior_training_history';
update privacy.scope_presentations set summary = 'Medidas y las fotos que elija, sin datos de salud.'
  where scope_code = 'body_progress';
update privacy.scope_presentations set summary = 'Dolores y lesiones que declare, sin historia clínica.'
  where scope_code = 'health_context';
update privacy.scope_presentations set summary = 'Las comidas que registre. Nunca podrás editarlas.'
  where scope_code = 'nutrition_intake';
update privacy.scope_presentations set summary = 'Objetivos de nutrición y sus decisiones, sin ver sus comidas.'
  where scope_code = 'nutrition_guidance';
update privacy.scope_presentations set summary = 'Las fotos de sus comidas. Requiere también ver lo que come.'
  where scope_code = 'nutrition_media';

-- Nullable until every row is filled, then required: a permission reaching the
-- invite form without a summary would render as a bare title, which is the
-- thing this migration exists to prevent.
alter table privacy.scope_presentations
  alter column summary set not null;

-- Dropped rather than replaced: `create or replace` cannot widen a function's
-- return type, and this one gains a column.
drop function if exists privacy.list_offerable_scopes();

create function privacy.list_offerable_scopes()
returns table (
  scope_definition_id uuid,
  scope_code text,
  version_number integer,
  display_name text,
  summary text,
  description text,
  default_purpose text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select distinct on (definition.scope_code)
         definition.id,
         definition.scope_code,
         definition.version_number,
         presentation.display_name,
         presentation.summary,
         presentation.description,
         presentation.default_purpose
  from privacy.scope_definitions as definition
  join privacy.scope_presentations as presentation
    on presentation.scope_code = definition.scope_code
  where definition.status = 'published'
    and access_control.actor_kind() = 'person'
  order by definition.scope_code, definition.version_number desc
$function$;

alter function privacy.list_offerable_scopes() owner to allfit_owner;
revoke all on function privacy.list_offerable_scopes() from public;
grant execute on function privacy.list_offerable_scopes() to allfit_api;
