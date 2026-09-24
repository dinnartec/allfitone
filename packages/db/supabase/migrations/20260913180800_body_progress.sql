-- Body measurements: the one onboarding answer that is not a profile claim.
--
-- Weight and height are a time series, and criterion 2 of `HU-SP-011` says so —
-- "they stay as my first progress record". So they go to
-- `identity.body_progress_records`, which the dictionary specified in §4.7 and
-- nobody had built. Everything here is construction against a contract that already
-- existed: `OP-IDN-006` fixes the surface, the idempotency and the classification.
--
-- **Two records, so two commands.** `OP-IDN-006` fixes
-- `Command-Id = BODY_PROGRESS_RECORD.id`: one command, one row. Weight and height
-- have different `metric_code`, so they are two independent measurements with their
-- own keys. That is not a workaround — later somebody updates their weight without
-- touching their height, and if the second call fails the first stays saved and the
-- retry replays it instead of duplicating. It also avoids repeating the departure
-- `focus_areas` needed, where one command wrote N rows and the identity had to move
-- to the receipt.
--
-- **The database converts, not the client.** The person sends what they chose — 163,
-- `lb` — and the function computes the canonical value from
-- `catalog.units.to_canonical_factor`. Keeping the factor in a catalogue and then
-- converting in the app would be two truths about the same number. Both are stored,
-- which is what §4.7 asks for and what stops the rounding that eats the datum:
-- keeping only what was displayed makes 74 kg → 163 lb → 73.9 kg, and somebody's
-- weight moves on its own for changing units and back.
--
-- `original_*` stays null when the chosen unit is already canonical: there is nothing
-- to preserve, and "original is not null" then means exactly "she read it in another
-- unit".
--
-- **Real units, at last.** `catalog.units` held only synthetic `test_*` rows from
-- `seed.sql`, which states production does not load it. Kilogram, pound, centimetre
-- and inch are curated here because this is the first screen that needs them.
--
-- **And the catalogue was unreadable.** Its only policy was `to allfit_owner` with no
-- grant for the runtime role, so Space could not enumerate the units its own screen
-- offers. The dictionary already said "lectura autenticada" in §8.9, so this is not a
-- change of the rule — it is the schema catching up with it.
--
-- Two narrowings, the same criterion `20260823210000_profile_claims.sql` used:
--   * `metric_code` gets a closed check. The dictionary gives it no FK and no
--     catalogue, so it is free text today and a typo would invent a metric nobody
--     writes again. `body_` is not decoration: `metric_code` also exists in execution
--     results, where `weight` is the load on the bar.
--   * RLS is `is_self` only. The other half of the dictionary rule — the professional
--     holding `body_progress` — depends on `access_control.can_access`, which does not
--     exist. Stricter than the target, never looser.
--
-- **Skipping is recorded, or the screen asks again.** `HU-SP-011` criterion 3 allows
-- it and `HU-SP-015` generalises it, and this is the first screen to exercise it. A
-- column per step on the attempt — the shape the biological sex uses — would have
-- reproduced the problem that already forced the onboarding read into a single
-- `answers` object: every new step changes the table. Here the step is a **value**, so
-- `identity.onboarding_step_skips` does not grow when the onboarding does. An array of
-- codes was the other temptation and the modelling standard forbids it: sets are
-- explicit tables.
--
-- That table needs no idempotency receipt. Its primary key is the whole guarantee:
-- skipping twice writes one row, and a skip carries no body that a replay could
-- contradict.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- units

-- Las dimensiones reales. Las filas `test_*` del seed son sintéticas y no chocan:
-- viven en dimensiones propias.
insert into catalog.units (code, dimension, is_canonical, to_canonical_factor)
values
  ('kg', 'mass',   true,  1),
  ('lb', 'mass',   false, 0.45359237),
  ('cm', 'length', true,  1),
  ('in', 'length', false, 2.54);

-- §8.9 ya declaraba «lectura autenticada» y el esquema no lo cumplía.
create policy units_select_authenticated on catalog.units
  for select to allfit_api using (access_control.actor_kind() <> 'anonymous');

grant select on catalog.units to allfit_api;

-- Y el dueño tampoco podía leerlas aquí. La política existente, `units_select_actor`,
-- exige `access_control.person() is not null`, y durante el onboarding el actor es una
-- **cuenta**: la persona todavía puede no existir. Escrita para Studio, donde el actor
-- siempre es una persona, deja a cualquier función `security definer` del onboarding
-- viendo un catálogo vacío — que es como se descubrió, con la conversión rechazando
-- kilogramos por «no pertenecer a la dimensión».
--
-- Se añade en vez de reemplazarla: las políticas permisivas se combinan con OR, así que
-- esto abre el caso que faltaba sin tocar una sentencia de otra rebanada.
--
-- La condición es **haber una cuenta**, no «no ser anónimo». Probé lo segundo y
-- `T-CAT-RLS-15` lo rechazó con razón: esa prueba simula el contexto no autenticado
-- vaciando la persona y la organización, y `actor_kind` sigue en pie, así que la
-- versión laxa dejaba leer el catálogo sin identidad ninguna. Con la cuenta, un
-- contexto vacío sigue sin leer nada y el onboarding sí.
create policy units_select_owner_account on catalog.units
  for select to allfit_owner using (access_control.account() is not null);

-- ---------------------------------------------------------------- measurements

create table identity.body_progress_records (
  id uuid not null,
  person_id uuid not null,
  metric_code text not null,
  value_numeric numeric not null,
  unit_code text not null,
  original_value numeric,
  original_unit_code text,
  measured_on date not null default current_date,
  media_ref text,
  has_media boolean not null default false,
  constraint pk_body_progress_records primary key (id),
  constraint fk_body_progress_records_person foreign key (person_id) references identity.people (id) on delete restrict,
  constraint fk_body_progress_records_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint fk_body_progress_records_original_unit foreign key (original_unit_code) references catalog.units (code) on delete restrict,
  constraint ck_body_progress_records_metric check (metric_code in ('body_weight', 'body_height')),
  constraint ck_body_progress_records_value check (value_numeric > 0),
  constraint ck_body_progress_records_media check (has_media = (media_ref is not null)),
  -- Media pareja de original no dice nada: o están las dos o no está ninguna.
  constraint ck_body_progress_records_original check ((original_value is null) = (original_unit_code is null))
);

alter table identity.body_progress_records owner to allfit_owner;

create index idx_body_progress_records_series
  on identity.body_progress_records (person_id, measured_on desc);

-- ---------------------------------------------------------------- skips

create table identity.onboarding_step_skips (
  onboarding_attempt_id uuid not null,
  step_code text not null,
  skipped_at timestamptz not null default clock_timestamp(),
  constraint pk_onboarding_step_skips primary key (onboarding_attempt_id, step_code),
  constraint fk_onboarding_step_skips_attempt foreign key (onboarding_attempt_id) references identity.onboarding_attempts (id) on delete cascade,
  constraint ck_onboarding_step_skips_code check (step_code ~ '^[a-z][a-z0-9_]{1,63}$')
);

alter table identity.onboarding_step_skips owner to allfit_owner;

-- ---------------------------------------------------------------- rls

alter table identity.body_progress_records enable row level security;
alter table identity.body_progress_records force row level security;
alter table identity.onboarding_step_skips enable row level security;
alter table identity.onboarding_step_skips force row level security;

create policy body_progress_records_all_owner on identity.body_progress_records
  for all to allfit_owner using (true) with check (true);
-- Solo lectura propia. El profesional con `body_progress` espera a que exista
-- `access_control.can_access`; `relationship_training` no alcanza a este dato.
create policy body_progress_records_select_self on identity.body_progress_records
  for select to allfit_api using (access_control.is_self(person_id));

create policy onboarding_step_skips_all_owner on identity.onboarding_step_skips
  for all to allfit_owner using (true) with check (true);
create policy onboarding_step_skips_select_own on identity.onboarding_step_skips
  for select to allfit_api using (
    exists (
      select 1
      from identity.onboarding_attempts as attempt
      where attempt.id = onboarding_step_skips.onboarding_attempt_id
        and attempt.account_id = access_control.account()
    )
  );

-- La escritura entra por la función, nunca por la tabla.
revoke insert, update, delete on identity.body_progress_records from allfit_api;
revoke insert, update, delete on identity.onboarding_step_skips from allfit_api;
grant select on identity.body_progress_records to allfit_api;
grant select on identity.onboarding_step_skips to allfit_api;

-- ---------------------------------------------------------------- commands

-- Qué dimensión corresponde a cada métrica. Un peso en centímetros se rechaza aquí,
-- no solo en la pantalla: un estado imposible no depende de que el cliente se porte bien.
create or replace function identity.metric_dimension(p_metric_code text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_metric_code
    when 'body_weight' then 'mass'
    when 'body_height' then 'length'
  end
$function$;

alter function identity.metric_dimension(text) owner to allfit_owner;

create or replace function identity.record_body_progress(
  p_account_id uuid,
  p_metric_code text,
  p_value numeric,
  p_unit_code text,
  p_measured_on date,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  record_id uuid,
  metric_code text,
  value_numeric numeric,
  unit_code text,
  original_value numeric,
  original_unit_code text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject_person_id uuid;
  chosen catalog.units%rowtype;
  canonical catalog.units%rowtype;
  -- Nombrada así y no `dimension`: como variable choca con la columna del catálogo
  -- y PostgreSQL rechaza la referencia por ambigua.
  wanted_dimension text;
  created identity.body_progress_records%rowtype;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  select access_account.person_id into subject_person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

  -- La persona es el sujeto de la medición. Sin ella no hay nada que medir.
  if subject_person_id is null then
    raise exception 'the account owns no person yet' using errcode = '42501';
  end if;

  wanted_dimension := identity.metric_dimension(p_metric_code);

  -- Todo se valida antes de tocar la idempotencia: una petición inválida que quemara
  -- la clave dejaría fallando al reintento correcto.
  if wanted_dimension is null then
    raise exception 'unknown body metric' using errcode = '23514';
  end if;
  if p_value is null or p_value <= 0 then
    raise exception 'a measurement needs a positive value' using errcode = '23514';
  end if;
  if p_measured_on is null or p_measured_on > current_date then
    raise exception 'a measurement cannot be taken in the future' using errcode = '23514';
  end if;

  select * into chosen from catalog.units where code = p_unit_code;
  if chosen.code is null or chosen.dimension <> wanted_dimension then
    raise exception 'the unit does not belong to the dimension of the metric' using errcode = '23514';
  end if;

  select * into canonical
  from catalog.units
  where catalog.units.dimension = wanted_dimension and catalog.units.is_canonical;

  if canonical.code is null then
    raise exception 'the dimension has no canonical unit' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-006',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into created from identity.body_progress_records where id = receipt.aggregate_id;
    return query select created.id, created.metric_code, created.value_numeric, created.unit_code,
                        created.original_value, created.original_unit_code, true;
    return;
  end if;

  -- El id es el Command-Id del dispositivo, como fija OP-IDN-006: la clave primaria
  -- rechaza por sí sola una segunda medición del mismo comando.
  --
  -- El original solo se guarda cuando la unidad elegida no era la canónica; así
  -- «original is not null» significa exactamente «la leyó en otra unidad».
  insert into identity.body_progress_records (
    id, person_id, metric_code, value_numeric, unit_code,
    original_value, original_unit_code, measured_on
  ) values (
    p_command_id,
    subject_person_id,
    p_metric_code,
    p_value * chosen.to_canonical_factor,
    canonical.code,
    case when chosen.is_canonical then null else p_value end,
    case when chosen.is_canonical then null else chosen.code end,
    p_measured_on
  )
  returning * into created;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'body-progress-recorded',
    'body_progress_record',
    created.id
  );

  return query select created.id, created.metric_code, created.value_numeric, created.unit_code,
                      created.original_value, created.original_unit_code, false;
end
$function$;

alter function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) from public;
grant execute on function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) to allfit_api;

-- Sin recibo de idempotencia: la clave primaria es toda la garantía, y un salto no
-- lleva cuerpo que un replay pudiera contradecir.
create or replace function identity.skip_onboarding_step(
  p_account_id uuid,
  p_attempt_id uuid,
  p_step_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from identity.onboarding_attempts as attempt
    where attempt.id = p_attempt_id
      and attempt.account_id = p_account_id
      and attempt.status = 'open'
      and attempt.expires_at > clock_timestamp()
  ) then
    raise exception 'no open onboarding attempt for this account' using errcode = '42501';
  end if;

  insert into identity.onboarding_step_skips (onboarding_attempt_id, step_code)
  values (p_attempt_id, p_step_code)
  on conflict do nothing;
end
$function$;

alter function identity.skip_onboarding_step(uuid, uuid, text) owner to allfit_owner;
revoke all on function identity.skip_onboarding_step(uuid, uuid, text) from public;
grant execute on function identity.skip_onboarding_step(uuid, uuid, text) to allfit_api;

-- ---------------------------------------------------------------- resume read

-- El paso se lee con la misma forma que los demás. `answered` verdadero con valor
-- nulo significa «lo saltó», que es exactamente lo que ya significa en el sexo
-- declinado: la pregunta dejó de estar pendiente sin afirmar nada de la persona.
--
-- Responder exige **las dos** medidas. Si solo se guardó una —la segunda falló—, el
-- paso sigue debiéndose y el valor parcial vuelve para prellenar la regla.
create or replace function identity.read_current_onboarding(p_account_id uuid)
returns table (
  attempt_id uuid,
  status text,
  eligibility_status text,
  expires_at timestamptz,
  answers jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select attempt.id,
         attempt.status::text,
         coalesce(evidence.result::text, 'pending'),
         attempt.expires_at,
         jsonb_build_object(
           'identity', jsonb_build_object(
             'answered', person.id is not null,
             'value', case
               when person.id is null then null
               else jsonb_build_object(
                 'given_name', person.given_name,
                 'family_name', person.family_name,
                 'username', person.username::text
               )
             end
           ),
           'biological_sex', jsonb_build_object(
             'answered', attempt.biological_sex_answered_at is not null,
             'value', person.biological_sex::text
           ),
           'primary_training_goal', jsonb_build_object(
             'answered', goal.value_text is not null,
             'value', goal.value_text
           ),
           'focus_areas', jsonb_build_object(
             'answered', cardinality(focus.areas) > 0,
             'value', to_jsonb(focus.areas)
           ),
           'training_experience', jsonb_build_object(
             'answered', experience.value_text is not null,
             'value', experience.value_text
           ),
           'body_measures', jsonb_build_object(
             'answered', skipped.step_code is not null
               or (weight.value_numeric is not null and height.value_numeric is not null),
             'value', case
               when weight.value_numeric is null and height.value_numeric is null then null
               else jsonb_build_object(
                 'weight', case
                   when weight.value_numeric is null then null
                   else jsonb_build_object(
                     'value', weight.value_numeric,
                     'unit', weight.unit_code,
                     'original_unit', weight.original_unit_code
                   )
                 end,
                 'height', case
                   when height.value_numeric is null then null
                   else jsonb_build_object(
                     'value', height.value_numeric,
                     'unit', height.unit_code,
                     'original_unit', height.original_unit_code
                   )
                 end
               )
             end
           )
         )
  from identity.onboarding_attempts as attempt
  left join identity.people as person on person.id = attempt.person_id
  left join lateral (
    select evidence.result
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = attempt.id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1
  ) as evidence on true
  left join lateral (
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'primary_training_goal'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as goal on true
  left join lateral (
    select identity.current_focus_areas(person.id) as areas
  ) as focus on true
  left join lateral (
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'training_experience'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as experience on true
  -- La última de cada métrica: es una serie, así que lo vigente es lo más reciente.
  left join lateral (
    select record.value_numeric, record.unit_code, record.original_unit_code
    from identity.body_progress_records as record
    where record.person_id = person.id and record.metric_code = 'body_weight'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as weight on true
  left join lateral (
    select record.value_numeric, record.unit_code, record.original_unit_code
    from identity.body_progress_records as record
    where record.person_id = person.id and record.metric_code = 'body_height'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as height on true
  left join lateral (
    select skip.step_code
    from identity.onboarding_step_skips as skip
    where skip.onboarding_attempt_id = attempt.id and skip.step_code = 'body_measures'
    limit 1
  ) as skipped on true
  where attempt.account_id = p_account_id
    and attempt.status = 'open'
    and attempt.expires_at > clock_timestamp()
    and access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
