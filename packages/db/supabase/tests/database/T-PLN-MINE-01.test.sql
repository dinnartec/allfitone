-- Content a person makes for themselves.
--
-- What has to hold: a routine can be built, saved as a draft while incomplete, and
-- published; a programme can be composed of the person's **own** routines and
-- published; a stale etag loses; and **the neighbour sees none of it**.
--
-- The neighbour pair was written before anything else and watched failing with the
-- ownership left off the copy: without `owner_person_id` the draft is nobody's and
-- every authenticated person reads it.
--
-- The programme assertion is the one that failed before this migration:
-- `program_content_errors` and `lock_program_template_versions` admitted templates
-- that were global or an organization's and nothing else, so a personal programme
-- made of personal routines could never be published.
begin;

select plan(12);

insert into identity.people (id, given_name, family_name)
values
  ('019ea000-0000-7000-8000-000000000001', 'Autora', 'Propia'),
  ('019ea000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ea000-0000-7000-8000-000000000001', true);

select (planning.create_my_session_template(
  '019ea000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  '82111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('f1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

select is(
  (select content_scope::text from planning.session_templates where id = :'template_id'::uuid),
  'person',
  'T-PLN-MINE-01 a routine somebody makes is theirs');

-- A discipline with one activity type poses no question, so the draft opens answered.
select is(
  (select content->>'activity_type_id' from planning.session_template_drafts
    where template_id = :'template_id'::uuid),
  '019c0000-0000-7000-8000-000000000011',
  'T-PLN-MINE-12 and the only activity type of its discipline is already in it');

-- An empty routine is a legitimate draft: `V-H` opens on one and saves as you type.
select is(
  (select jsonb_array_length(content->'steps') from planning.session_template_drafts
    where template_id = :'template_id'::uuid),
  0,
  'T-PLN-MINE-02 and starts as an empty draft');

select throws_ok(
  $$ select planning.publish_my_session_template('019ea000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ea000-0000-7000-8000-000000000001'), planning.content_etag((select content from planning.session_template_drafts where template_id = (select id from planning.session_templates where owner_person_id = '019ea000-0000-7000-8000-000000000001'))), '82111111-1111-4111-8111-111111111111', extensions.uuid_generate_v7(), decode(repeat('f2', 32), 'hex')) $$,
  '22023', null, 'T-PLN-MINE-03 but an empty routine cannot be published');

select (planning.replace_my_session_template_draft(
  '019ea000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8,"target_rest_seconds":90}}]}'::jsonb,
  '82111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('f3', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as etag1 \gset

-- The etag is the only thing between two devices editing the same draft.
select throws_ok(
  $$ select planning.replace_my_session_template_draft('019ea000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ea000-0000-7000-8000-000000000001'), 'W/"stale"', '{"title":"Otra","activity_type_id":null,"steps":[]}'::jsonb, '82111111-1111-4111-8111-111111111121', extensions.uuid_generate_v7(), decode(repeat('f4', 32), 'hex')) $$,
  '40001', null, 'T-PLN-MINE-04 a stale etag loses');

select (planning.publish_my_session_template(
  '019ea000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '82111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('f5', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as version_id \gset

select is(
  (select target_rest_seconds from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id = :'version_id'::uuid),
  90,
  'T-PLN-MINE-05 publishing writes the rest the step asks for');

select (planning.create_my_program(
  '019ea000-0000-7000-8000-000000000001', 'Mi programa',
  '82111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('f6', 32), 'hex'))).program as program \gset
select (:'program'::jsonb->>'id') as program_id,
       (:'program'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid, :'petag0',
  ('{"title":"Mi programa","notes":null,"sessions":[{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"},{"position":2,"week":2,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  '82111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('f7', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

-- The assertion this migration exists for.
select (planning.publish_my_program(
  '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid, :'petag1',
  '82111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('f8', 32), 'hex'))).version as pversion \gset
select (:'pversion'::jsonb->>'id') as program_version_id \gset

select is(
  (select count(*)::integer from planning.program_version_sessions
    where program_version_id = :'program_version_id'::uuid),
  2,
  'T-PLN-MINE-06 a programme composed of my own routines publishes');

select is(
  planning.self_assign_program(
    '019ea000-0000-7000-8000-000000000001', :'program_version_id'::uuid, 'America/Bogota',
    '82111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
    decode(repeat('f9', 32), 'hex')) is not null,
  true,
  'T-PLN-MINE-07 and can be taken');

-- Taking my own programme does not fork it: it is already mine.
select is(
  (select count(*)::integer from planning.programs
    where owner_person_id = '019ea000-0000-7000-8000-000000000001'),
  1,
  'T-PLN-MINE-08 taking my own programme does not copy it again');

select is(
  (select count(*)::integer from planning.planned_sessions
    where person_id = '019ea000-0000-7000-8000-000000000001'),
  2,
  'T-PLN-MINE-09 and puts its sessions in my calendar');

select set_config('app.actor_person_id', '019ea000-0000-7000-8000-000000000002', true);

select is(
  (select count(*) from planning.session_template_drafts where template_id = :'template_id'::uuid),
  0::bigint,
  'T-PLN-MINE-RLS-01 a neighbour does not read my draft');
select is(
  (select count(*) from planning.program_versions where id = :'program_version_id'::uuid),
  0::bigint,
  'T-PLN-MINE-RLS-02 nor the programme I published');

select * from finish();
rollback;
