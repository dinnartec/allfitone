-- DT-018, ADR-043 and HU-SP-084..088 — the functions a plan can limit, and how a limit
-- is asked.
--
-- The catalogue shipped empty on purpose until product decided it. These ten functions
-- enter together with the code that honours each one, in this migration and the ones
-- that follow it.
--
-- **A version that does not declare a function does not limit it.** Proposals already
-- have to declare every function in the catalogue, so a version without one was
-- published before the function existed: whoever holds it accepted no such limit, and
-- hardening the free plan takes nothing from them (DT-018). A limit starts to apply when
-- a new version declaring it is published, by two people, from Backoffice.
--
-- **A limit never destroys data.** What falls outside a history window is kept and comes
-- back with Pro; reading, downloading and deleting one's own data stay free, and no
-- function of the catalogue can name them (`ck_platform_features_not_privacy`).
--
-- A limit reached raises AF402 with the function's code in the detail, so the API can
-- tell the person which one and offer Pro.

set lock_timeout = '5s';
set statement_timeout = '60s';

insert into payments.platform_features (code, name, unit)
values
  ('training_history_months', 'Historial de entrenamiento visible', 'months'),
  ('nutrition_history_months', 'Historial de comidas visible', 'months'),
  ('active_personal_programs', 'Programas propios activos', 'programs'),
  ('own_routines', 'Rutinas propias', 'routines'),
  ('routine_duplication', 'Duplicar rutinas', null),
  ('full_program_catalogue', 'Catálogo completo de programas', null),
  ('period_analysis', 'Comparar periodos', null),
  ('body_measurements', 'Medidas del cuerpo', null),
  ('body_photos', 'Fotos del cuerpo', null),
  ('meal_photo_recognition', 'Comidas por foto con IA', null)
on conflict (code) do update set name = excluded.name, unit = excluded.unit;

-- ---------------------------------------------------------------------------
-- Reading a person's limit
-- ---------------------------------------------------------------------------

create or replace function payments.feature_for(p_person_id uuid, p_code text)
returns table (declared boolean, enabled boolean, limit_value integer)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  version uuid := (payments.resolve_pro(p_person_id)->>'version_id')::uuid;
begin
  return query
  select true, limit_row.enabled, limit_row.limit_value
  from payments.platform_plan_features as limit_row
  where limit_row.platform_plan_version_id = version
    and limit_row.feature_code = p_code;
  if not found then
    return query select false, true, null::integer;
  end if;
end
$function$;

create or replace function payments.require_feature(p_person_id uuid, p_code text)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if exists (
    select 1 from payments.feature_for(p_person_id, p_code) as feature
    where feature.declared and not feature.enabled
  ) then
    raise exception 'this function comes with Pro' using errcode = 'AF402', detail = p_code;
  end if;
end
$function$;

-- p_current is how many the person already has; the next one must fit under the limit.
create or replace function payments.require_below_limit(p_person_id uuid, p_code text, p_current integer)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if exists (
    select 1 from payments.feature_for(p_person_id, p_code) as feature
    where feature.declared
      and (not feature.enabled or (feature.limit_value is not null and p_current >= feature.limit_value))
  ) then
    raise exception 'the plan reached its limit' using errcode = 'AF402', detail = p_code;
  end if;
end
$function$;

-- Where visible history starts, in the person's day; null when nothing is hidden.
create or replace function payments.history_cutoff(p_person_id uuid, p_code text, p_timezone text)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when not feature.declared or (feature.enabled and feature.limit_value is null) then null
    when not feature.enabled then clock_timestamp()
    else (date_trunc('day', clock_timestamp() at time zone p_timezone)
          - make_interval(months => feature.limit_value)) at time zone p_timezone
  end
  from payments.feature_for(p_person_id, p_code) as feature
$function$;

alter function payments.feature_for(uuid, text) owner to allfit_owner;
alter function payments.require_feature(uuid, text) owner to allfit_owner;
alter function payments.require_below_limit(uuid, text, integer) owner to allfit_owner;
alter function payments.history_cutoff(uuid, text, text) owner to allfit_owner;

revoke all on function payments.feature_for(uuid, text) from public, allfit_api;
revoke all on function payments.require_feature(uuid, text) from public, allfit_api;
revoke all on function payments.require_below_limit(uuid, text, integer) from public, allfit_api;
revoke all on function payments.history_cutoff(uuid, text, text) from public, allfit_api;

-- ---------------------------------------------------------------------------
-- The programme catalogue names the function that opens each programme
-- ---------------------------------------------------------------------------

-- Null is the free selection. A partner's programmes can later ask for a function of
-- their own, and each plan decides whether it includes it.
alter table planning.programs
  add column unlock_feature_code text,
  add constraint fk_programs_unlock_feature foreign key (unlock_feature_code)
    references payments.platform_features(code) on delete restrict,
  add constraint ck_programs_unlock_feature_global check (
    unlock_feature_code is null or content_scope = 'global'
  );

create index idx_programs_unlock_feature on planning.programs (unlock_feature_code)
  where unlock_feature_code is not null;
