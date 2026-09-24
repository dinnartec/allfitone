-- Profile claims: the piece seven stories were waiting on.
--
-- `identity.profile_attributes` and `identity.fitness_profile_claims` were
-- specified in the data dictionary and never built, which is why the traceability matrix said no profile claim was writable at
-- all — `HU-SP-010` through `HU-SP-014`, `HU-SP-021` and `HU-SP-096`. The biological
-- sex went around it as a column, defensibly: a single stable fact with one source.
-- The training goal is where going around stops paying, and two screens later the
-- weight and height cannot go around at all, because they are a time series.
--
-- Two shapes carry the design. **The claim id is the device's Command-Id**, so the
-- primary key itself refuses a second claim from the same command; the durable
-- receipt is the second line, not the first. And **claims are append-only**: `UPDATE`
-- is revoked from the runtime role, so changing an answer writes another row and
-- stamps `superseded_by_id` from a governed function. That is what lets a
-- professional observation and a person's declaration about the same attribute
-- coexist instead of overwriting each other — and, for the goal, what keeps the
-- record that the intention changed.
--
-- Only one member is declared, `primary_training_goal`. Declaring the rest without
-- the screens that write them would invent vocabulary that will not fit; adding one
-- later is an `insert` here, not a migration, and that is the whole point of paying
-- for this now.
--
-- Two departures from the dictionary, both narrowing rather than widening:
--   * `allowed_values` is added to the attribute catalogue. The dictionary declares
--     `value_kind` as enum but gives the members nowhere to live, and leaving that to
--     the application would put a validation rule outside the database.
--   * The professional read half of the RLS rule is not written. It depends on
--     `access_control.can_access(...)` and the consent machinery, and neither exists
--     yet. Only `is_self` is granted, which is stricter than the target, never looser.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- classifications

-- `privacy.data_classifications` and its rows come from main's
-- 20260910150000_privacy_scope_publication, which runs before this migration.

-- ---------------------------------------------------------------- provenance

create type identity.provenance as enum (
  'person_declared',
  'professional_observation',
  'device_observed',
  'system_inferred',
  'authority_verified'
);
alter type identity.provenance owner to allfit_owner;

-- ---------------------------------------------------------------- attributes

create table identity.profile_attributes (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  data_classification_code text not null,
  value_kind text not null,
  unit_dimension text,
  allowed_values text[],
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_profile_attributes primary key (id),
  constraint uq_profile_attributes_code unique (code),
  constraint fk_profile_attributes_classification foreign key (data_classification_code) references privacy.data_classifications (code) on delete restrict,
  constraint ck_profile_attributes_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_profile_attributes_name check (btrim(name) <> '' and char_length(name) <= 120),
  constraint ck_profile_attributes_value_kind check (value_kind in ('numeric', 'text', 'enum')),
  constraint ck_profile_attributes_allowed_values check ((value_kind = 'enum' and allowed_values is not null and cardinality(allowed_values) >= 2) or (value_kind <> 'enum' and allowed_values is null)),
  constraint ck_profile_attributes_unit_dimension check (unit_dimension is null or value_kind = 'numeric')
);

alter table identity.profile_attributes owner to allfit_owner;

-- Los seis del criterio 1 de HU-SP-010. `training` porque el profesional programa
-- contra el objetivo: sin verlo no puede ajustar volumen ni intensidad.
insert into identity.profile_attributes (code, name, data_classification_code, value_kind, allowed_values)
values (
  'primary_training_goal',
  'Objetivo principal de entrenamiento',
  'training',
  'enum',
  array['lose_weight', 'build_muscle', 'get_fit', 'improve_performance', 'run_a_race', 'maintain']
);

-- ---------------------------------------------------------------- claims

create table identity.fitness_profile_claims (
  id uuid not null,
  person_id uuid not null,
  attribute_code text not null,
  value_numeric numeric,
  value_text text,
  unit_code text,
  provenance identity.provenance not null,
  captured_by_kind identity.actor_kind not null,
  captured_by_assignment_id uuid,
  valid_from timestamptz not null default clock_timestamp(),
  valid_to timestamptz,
  superseded_by_id uuid,
  constraint pk_fitness_profile_claims primary key (id),
  constraint fk_fitness_profile_claims_person foreign key (person_id) references identity.people (id) on delete restrict,
  constraint fk_fitness_profile_claims_attribute foreign key (attribute_code) references identity.profile_attributes (code) on delete restrict,
  constraint fk_fitness_profile_claims_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint fk_fitness_profile_claims_superseded foreign key (superseded_by_id) references identity.fitness_profile_claims (id) on delete restrict,
  constraint ck_fitness_profile_claims_value check (value_numeric is not null or value_text is not null),
  constraint ck_fitness_profile_claims_validity check (valid_to is null or valid_to > valid_from),
  constraint ck_fitness_profile_claims_not_self_superseded check (superseded_by_id is null or superseded_by_id <> id)
);

alter table identity.fitness_profile_claims owner to allfit_owner;

create index idx_fitness_profile_claims_lookup
  on identity.fitness_profile_claims (person_id, attribute_code, valid_from desc);

-- ---------------------------------------------------------------- rls

alter table identity.profile_attributes enable row level security;
alter table identity.profile_attributes force row level security;
alter table identity.fitness_profile_claims enable row level security;
alter table identity.fitness_profile_claims force row level security;

create policy profile_attributes_all_owner on identity.profile_attributes
  for all to allfit_owner using (true) with check (true);
create policy profile_attributes_select_authenticated on identity.profile_attributes
  for select to allfit_api using (access_control.actor_kind() <> 'anonymous');

create policy fitness_profile_claims_all_owner on identity.fitness_profile_claims
  for all to allfit_owner using (true) with check (true);
-- Solo lectura propia. El otro medio de la regla del diccionario —el profesional con
-- grant vigente— espera a que exista `access_control.can_access`.
create policy fitness_profile_claims_select_self on identity.fitness_profile_claims
  for select to allfit_api using (access_control.is_self(person_id));

-- Append-only: la escritura entra por la función, nunca por la tabla.
revoke insert, update, delete on identity.fitness_profile_claims from allfit_api;
grant select on identity.fitness_profile_claims to allfit_api;
grant select on identity.profile_attributes to allfit_api;

-- ---------------------------------------------------------------- command

create or replace function identity.declare_profile_claim(
  p_account_id uuid,
  p_attribute_code text,
  p_value_text text,
  p_value_numeric numeric,
  p_unit_code text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  claim_id uuid,
  attribute_code text,
  value_text text,
  value_numeric numeric,
  superseded_claim_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attribute identity.profile_attributes%rowtype;
  subject_person_id uuid;
  previous_id uuid;
  created identity.fitness_profile_claims%rowtype;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  select access_account.person_id into subject_person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

  -- La persona es el sujeto de la afirmación. Sin ella no hay nada que afirmar.
  if subject_person_id is null then
    raise exception 'the account owns no person yet' using errcode = '42501';
  end if;

  select * into attribute
  from identity.profile_attributes
  where code = p_attribute_code;

  -- El atributo desconocido se rechaza antes de tocar la idempotencia: si no, un
  -- código inventado quemaría la clave y el reintento correcto fallaría.
  if attribute.code is null then
    raise exception 'unknown profile attribute' using errcode = '23514';
  end if;

  if attribute.value_kind = 'enum' then
    if p_value_text is null or not (p_value_text = any (attribute.allowed_values)) then
      raise exception 'value is not a member of the attribute catalogue' using errcode = '23514';
    end if;
    if p_value_numeric is not null or p_unit_code is not null then
      raise exception 'an enum attribute carries no number and no unit' using errcode = '23514';
    end if;
  elsif attribute.value_kind = 'numeric' then
    if p_value_numeric is null then
      raise exception 'a numeric attribute requires a number' using errcode = '23514';
    end if;
  else
    if p_value_text is null or btrim(p_value_text) = '' then
      raise exception 'a text attribute requires a value' using errcode = '23514';
    end if;
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-004',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into created from identity.fitness_profile_claims where id = receipt.aggregate_id;
    return query select created.id, created.attribute_code, created.value_text,
                        created.value_numeric, null::uuid, true;
    return;
  end if;

  -- La afirmación vigente de esta persona sobre este atributo, si la hay. Solo la
  -- propia: una observación profesional coexiste y no se supersede desde aquí.
  select claim.id into previous_id
  from identity.fitness_profile_claims as claim
  where claim.person_id = subject_person_id
    and claim.attribute_code = attribute.code
    and claim.provenance = 'person_declared'
    and claim.superseded_by_id is null
    and claim.valid_to is null
  order by claim.valid_from desc
  limit 1
  for update;

  -- El id es el Command-Id del dispositivo: la clave primaria rechaza por sí sola
  -- una segunda afirmación del mismo comando, sin depender del receipt.
  insert into identity.fitness_profile_claims (
    id, person_id, attribute_code, value_text, value_numeric, unit_code,
    provenance, captured_by_kind
  ) values (
    p_command_id,
    subject_person_id,
    attribute.code,
    case when attribute.value_kind = 'numeric' then null else btrim(p_value_text) end,
    p_value_numeric,
    p_unit_code,
    'person_declared',
    'person'
  )
  returning * into created;

  -- Cambiar de respuesta no edita: la anterior queda cerrada y apuntando a la nueva,
  -- así que el historial conserva que la intención cambió.
  if previous_id is not null then
    update identity.fitness_profile_claims as claim
    set superseded_by_id = created.id,
        valid_to = created.valid_from
    where claim.id = previous_id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'profile-claim-declared',
    'fitness_profile_claim',
    created.id
  );

  return query select created.id, created.attribute_code, created.value_text,
                      created.value_numeric, previous_id, false;
end
$function$;

alter function identity.declare_profile_claim(uuid, text, text, numeric, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.declare_profile_claim(uuid, text, text, numeric, text, uuid, uuid, bytea) from public;
grant execute on function identity.declare_profile_claim(uuid, text, text, numeric, text, uuid, uuid, bytea) to allfit_api;
