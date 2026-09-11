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

select plan(24);

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

-- Editing it: the read that opens the editor, and what republishing does to the
-- agenda somebody is already on.

select is(
  planning.read_my_program_draft(
    '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid) is not null,
  true,
  'T-PLN-MINE-10 a programme I wrote can be read back in the shape I edit it in');

select is(
  jsonb_array_length(
    planning.read_my_program_draft(
      '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid)->'content'->'sessions'),
  2,
  'T-PLN-MINE-11 with the routine version each day points at, which the published read never says');

select is(
  (select editable from planning.read_my_programs('019ea000-0000-7000-8000-000000000001') limit 1),
  true,
  'T-PLN-MINE-12 and the list says so, so the row can offer to open it');

select is(
  (select program_id from planning.read_my_programs('019ea000-0000-7000-8000-000000000001') limit 1),
  :'program_id'::uuid,
  'T-PLN-MINE-13 and says which programme it is, which the row needs to address it');

-- One session is trained before the edit, which is the whole point of restating
-- rather than assigning again.
update planning.planned_sessions set status = 'completed'
where person_id = '019ea000-0000-7000-8000-000000000001'
  and id = (select id from planning.planned_sessions
            where person_id = '019ea000-0000-7000-8000-000000000001'
            order by scheduled_at limit 1);

select starts_on as kept_start from planning.program_assignments
where person_id = '019ea000-0000-7000-8000-000000000001' \gset

select is(
  planning.restate_my_program_assignment(
    '019ea000-0000-7000-8000-000000000001', :'program_version_id'::uuid,
    '82111111-1111-4111-8111-111111111108', extensions.uuid_generate_v7(),
    decode(repeat('fa', 32), 'hex')) is not null,
  true,
  'T-PLN-MINE-14 republishing restates the agenda I am already on');

select is(
  (select count(*)::integer from planning.program_assignments
    where person_id = '019ea000-0000-7000-8000-000000000001'),
  1,
  'T-PLN-MINE-15 and does not leave a second one, which nothing could remove');

select is(
  (select starts_on from planning.program_assignments
    where person_id = '019ea000-0000-7000-8000-000000000001'),
  :'kept_start'::date,
  'T-PLN-MINE-16 the week does not restart under somebody mid-week');

select is(
  (select count(*)::integer from planning.planned_sessions
    where person_id = '019ea000-0000-7000-8000-000000000001' and status = 'completed'),
  1,
  'T-PLN-MINE-17 and what was trained is still trained');

-- Adding a day to a week somebody has already trained in. Progress must grow rather
-- than freeze: protecting the whole trained week instead of the trained session is
-- what stopped the new day from ever arriving.
select (planning.read_my_program_draft(
  '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid)->>'etag') as petag2 \gset

select (planning.replace_my_program_draft(
  '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid, :'petag2',
  ('{"title":"Mi programa","notes":null,"sessions":[{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"},{"position":2,"week":1,"day":3,"template_version_id":"' || :'version_id' || '"},{"position":3,"week":2,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  '82111111-1111-4111-8111-111111111109', extensions.uuid_generate_v7(),
  decode(repeat('fb', 32), 'hex'))).draft as pdraft2 \gset
select (:'pdraft2'::jsonb->>'etag') as petag3 \gset

select (planning.publish_my_program(
  '019ea000-0000-7000-8000-000000000001', :'program_id'::uuid, :'petag3',
  '82111111-1111-4111-8111-11111111110a', extensions.uuid_generate_v7(),
  decode(repeat('fc', 32), 'hex'))).version as pversion2 \gset

select planning.restate_my_program_assignment(
  '019ea000-0000-7000-8000-000000000001', (:'pversion2'::jsonb->>'id')::uuid,
  '82111111-1111-4111-8111-11111111110b', extensions.uuid_generate_v7(),
  decode(repeat('fd', 32), 'hex'));

select is(
  (select count(*)::integer from planning.planned_sessions
    where person_id = '019ea000-0000-7000-8000-000000000001'
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  2,
  'T-PLN-MINE-18 a week that was trained in still takes the day added to it');

select is(
  (select sessions_done || ' de ' || sessions_planned
   from planning.read_my_programs('019ea000-0000-7000-8000-000000000001') limit 1),
  '1 de 3',
  'T-PLN-MINE-19 so the progress grows instead of freezing at one of one');

-- Null is the discriminator the publication depends on: it is how the API knows a
-- programme was never taken and has to be, instead of taking it every time and
-- leaving an edit with two assignments.
delete from planning.program_assignments
where person_id = '019ea000-0000-7000-8000-000000000001';

select is(
  planning.restate_my_program_assignment(
    '019ea000-0000-7000-8000-000000000001', :'program_version_id'::uuid,
    '82111111-1111-4111-8111-111111111109', extensions.uuid_generate_v7(),
    decode(repeat('fb', 32), 'hex')),
  null::uuid,
  'T-PLN-MINE-20 restating a programme nobody follows answers null, not an agenda');

select is(
  (select count(*)::integer from planning.program_assignments
    where person_id = '019ea000-0000-7000-8000-000000000001'),
  0,
  'T-PLN-MINE-21 and starts nothing: publishing is not taking');

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
