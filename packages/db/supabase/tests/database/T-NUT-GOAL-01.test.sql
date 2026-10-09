-- La meta de nutrición: una sola activa, versionada; la persona publica la suya y decide
-- sobre lo que un profesional le propone (ADR-027, OP-NUT-006..008).
--
-- Quien come publica una meta, luego otra; Laura, su nutricionista en el gimnasio, le
-- propone una tercera, que acepta; una cuarta, que rechaza. La vecina no ve nada.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values ('019f1200-0000-7000-8000-000000000001', 'Quien', 'Come', 'active'),
       ('019f1200-0000-7000-8000-000000000002', 'La', 'Vecina', 'active'),
       ('019f1200-0000-7000-8000-000000000011', 'Laura', 'Gómez', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019f1200-0000-7000-8000-000000000101', 'gym', 'Bodytech',
  '{"party_kind":"legal_entity","party_name":"Bodytech SAS","purpose":"studio_operations"}');
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019f1200-0000-7000-8000-000000000201', '019f1200-0000-7000-8000-000000000101',
  '019f1200-0000-7000-8000-000000000011', 'active');
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019f1200-0000-7000-8000-000000000301', '019f1200-0000-7000-8000-000000000001',
  '019f1200-0000-7000-8000-000000000101', 'active');
insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values ('019f1200-0000-7000-8000-000000000401', '019f1200-0000-7000-8000-000000000301',
  '019f1200-0000-7000-8000-000000000001', '019f1200-0000-7000-8000-000000000101',
  '019f1200-0000-7000-8000-000000000201', 'holder', 'active');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1200-0000-7000-8000-000000000001', true);

-- ———————————————————————————————— publicar la meta propia (OP-NUT-007)

select nutrition.publish_self_goal_version('019f1200-0000-7000-8000-000000000001', null,
  '[{"nutrient_code":"energy","mode":"exact","minimum":null,"maximum":null,"exact":2300,"unit":"kcal"},
    {"nutrient_code":"protein","mode":"minimum","minimum":150,"maximum":null,"exact":null,"unit":"g"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111301', '019f1200-0000-7000-8000-000000000501', decode(repeat('31', 32), 'hex')) as first \gset

select is(
  jsonb_build_object('number', :'first'::jsonb->'version_number', 'status', :'first'::jsonb->'status',
    'origin', :'first'::jsonb->'origin', 'targets', jsonb_array_length(:'first'::jsonb->'targets')),
  '{"number": 1, "status": "active", "origin": "self", "targets": 2}'::jsonb,
  'T-NUT-GOAL-01 the first goal is version 1, and active');

select nutrition.publish_self_goal_version('019f1200-0000-7000-8000-000000000001', null,
  '[{"nutrient_code":"energy","mode":"range","minimum":2200,"maximum":2400,"exact":null,"unit":"kcal"},
    {"nutrient_code":"carbohydrates","mode":"range","minimum":220,"maximum":260,"exact":null,"unit":"g"},
    {"nutrient_code":"fat","mode":"maximum","minimum":null,"maximum":70,"exact":null,"unit":"g"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111302', '019f1200-0000-7000-8000-000000000502', decode(repeat('32', 32), 'hex'));

select is(
  (select array_agg(status::text order by version_number) from nutrition.goal_versions
   where person_id = '019f1200-0000-7000-8000-000000000001'),
  array['superseded', 'active'],
  'T-NUT-GOAL-02 publishing again supersedes the active one, which stays in the history');

select throws_ok(
  $$ select nutrition.publish_self_goal_version('019f1200-0000-7000-8000-000000000001', null,
       '[{"nutrient_code":"protein","mode":"range","minimum":170,"maximum":150,"exact":null,"unit":"g"}]'::jsonb,
       'f6111111-1111-4111-8111-111111111303', extensions.uuid_generate_v7(), decode(repeat('33', 32), 'hex')) $$,
  '23514', null, 'T-NUT-GOAL-03 a range whose minimum passes its maximum publishes nothing');

select throws_ok(
  $$ select nutrition.publish_self_goal_version('019f1200-0000-7000-8000-000000000001', null,
       '[{"nutrient_code":"water","mode":"exact","minimum":null,"maximum":null,"exact":2500,"unit":"g"}]'::jsonb,
       'f6111111-1111-4111-8111-111111111304', extensions.uuid_generate_v7(), decode(repeat('34', 32), 'hex')) $$,
  '23514', null, 'T-NUT-GOAL-04 a target in a unit that is not its nutrient''s is refused');

-- ———————————————————————————————— una propuesta (aún sin operación que la cree)

-- Studio does not propose yet (OP-NUT-012), so the proposals are written as it will.
set local role postgres;
insert into nutrition.goal_versions (id, goal_set_id, person_id, version_number, origin, status, rationale,
  author_person_id, author_membership_id, author_assignment_id, origin_relationship_id, origin_organization_id)
select '019f1200-0000-7000-8000-000000000601', goal_set.id, goal_set.person_id, 3, 'professional', 'proposed',
  'Para tu fase de definición: un poco menos de energía y más proteína.',
  '019f1200-0000-7000-8000-000000000011', '019f1200-0000-7000-8000-000000000201',
  '019f1200-0000-7000-8000-000000000401', '019f1200-0000-7000-8000-000000000301',
  '019f1200-0000-7000-8000-000000000101'
from nutrition.goal_sets as goal_set where goal_set.person_id = '019f1200-0000-7000-8000-000000000001';
insert into nutrition.goal_targets (goal_version_id, nutrient_definition_id, mode, exact_value, unit_code)
select '019f1200-0000-7000-8000-000000000601', definition.id, 'exact', 2100, 'kcal'
from nutrition.nutrient_definitions as definition where definition.code = 'energy';

-- ———————————————————————————————— leer (OP-NUT-006)

select nutrition.read_my_goals('019f1200-0000-7000-8000-000000000001') as goals \gset

select is(
  jsonb_build_object('active', :'goals'::jsonb->'active'->'version_number',
    'proposals', (select jsonb_agg(p->'id') from jsonb_array_elements(:'goals'::jsonb->'proposals') as p),
    'author', :'goals'::jsonb->'proposals'->0->'author'),
  '{"active": 2, "proposals": ["019f1200-0000-7000-8000-000000000601"],
    "author": {"kind": "professional", "person_id": "019f1200-0000-7000-8000-000000000011",
               "display_name": "Laura Gómez", "organization_name": "Bodytech"}}'::jsonb,
  'T-NUT-GOAL-05 the active goal and what is proposed, with who proposes it and from where');

-- ———————————————————————————————— decidir (OP-NUT-008)

select nutrition.decide_goal_version('019f1200-0000-7000-8000-000000000001', '019f1200-0000-7000-8000-000000000601',
  'accepted', 'f6111111-1111-4111-8111-111111111305', '019f1200-0000-7000-8000-000000000701',
  decode(repeat('35', 32), 'hex')) as accepted \gset

select is(
  jsonb_build_object('decision', :'accepted'::jsonb->'decision', 'active', :'accepted'::jsonb->'active_goal_version_id'),
  '{"decision": "accepted", "active": "019f1200-0000-7000-8000-000000000601"}'::jsonb,
  'T-NUT-GOAL-06 accepting makes the proposal the active goal');

select is(
  (select array_agg(status::text order by version_number) from nutrition.goal_versions
   where person_id = '019f1200-0000-7000-8000-000000000001'),
  array['superseded', 'superseded', 'active'],
  'T-NUT-GOAL-07 and the goal it replaced stays in the history');

select throws_ok(
  $$ select nutrition.decide_goal_version('019f1200-0000-7000-8000-000000000001', '019f1200-0000-7000-8000-000000000601',
       'rejected', 'f6111111-1111-4111-8111-111111111306', extensions.uuid_generate_v7(), decode(repeat('36', 32), 'hex')) $$,
  '23514', null, 'T-NUT-GOAL-08 a proposal is decided once');

insert into nutrition.goal_versions (id, goal_set_id, person_id, version_number, origin, status, rationale,
  author_person_id, author_membership_id, author_assignment_id, origin_relationship_id, origin_organization_id)
select '019f1200-0000-7000-8000-000000000602', goal_set.id, goal_set.person_id, 4, 'professional', 'proposed',
  'Más agua.', '019f1200-0000-7000-8000-000000000011', '019f1200-0000-7000-8000-000000000201',
  '019f1200-0000-7000-8000-000000000401', '019f1200-0000-7000-8000-000000000301',
  '019f1200-0000-7000-8000-000000000101'
from nutrition.goal_sets as goal_set where goal_set.person_id = '019f1200-0000-7000-8000-000000000001';
insert into nutrition.goal_targets (goal_version_id, nutrient_definition_id, mode, exact_value, unit_code)
select '019f1200-0000-7000-8000-000000000602', definition.id, 'exact', 2500, 'ml'
from nutrition.nutrient_definitions as definition where definition.code = 'water';

select is(
  (nutrition.decide_goal_version('019f1200-0000-7000-8000-000000000001', '019f1200-0000-7000-8000-000000000602',
     'rejected', 'f6111111-1111-4111-8111-111111111307', extensions.uuid_generate_v7(),
     decode(repeat('37', 32), 'hex')))->>'active_goal_version_id',
  '019f1200-0000-7000-8000-000000000601',
  'T-NUT-GOAL-09 rejecting changes nothing: the active goal stays');

select throws_ok(
  $$ select nutrition.decide_goal_version('019f1200-0000-7000-8000-000000000001', '019f1200-0000-7000-8000-000000000502',
       'accepted', 'f6111111-1111-4111-8111-111111111308', extensions.uuid_generate_v7(), decode(repeat('38', 32), 'hex')) $$,
  '23514', null, 'T-NUT-GOAL-10 only a professional proposal can be decided, not one''s own goal');

select throws_ok(
  $$ update nutrition.goal_decisions set decision = 'rejected' $$,
  '42501', null, 'T-NUT-GOAL-11 a decision is never rewritten');

-- ———————————————————————————————— la vecina

select set_config('app.actor_person_id', '019f1200-0000-7000-8000-000000000002', true);

select is(
  nutrition.read_my_goals('019f1200-0000-7000-8000-000000000002'),
  '{"active": null, "proposals": []}'::jsonb,
  'T-NUT-GOAL-12 T-NUT-RLS-05 the neighbour sees no goal of another person''s');

select throws_ok(
  $$ select nutrition.decide_goal_version('019f1200-0000-7000-8000-000000000002', '019f1200-0000-7000-8000-000000000602',
       'accepted', 'f6111111-1111-4111-8111-111111111309', extensions.uuid_generate_v7(), decode(repeat('39', 32), 'hex')) $$,
  '42501', null, 'T-NUT-GOAL-13 T-NUT-RLS-05 nor decides on its proposals');

select * from finish();
rollback;
