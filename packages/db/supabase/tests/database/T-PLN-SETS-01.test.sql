-- Sets one by one, chains, and a draft that can be found again.
--
-- What has to hold: a strength step declares its sets; a set to failure carries no
-- reps; the summary is derived from the rows and nobody authors it; a chain is a run of
-- neighbours; a published version admits no set written afterwards; a draft can be read
-- back and only by its owner; and discarding is a state that refuses a routine with a
-- published version.
--
-- The negatives were written first and watched succeeding: without the triggers a
-- routine could publish a summary that disagreed with its own sets, and a superset
-- could name the first exercise and the fifth.
begin;

select plan(16);

insert into identity.people (id, given_name, family_name)
values
  ('019ec000-0000-7000-8000-000000000001', 'Quien', 'Entrena'),
  ('019ec000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ec000-0000-7000-8000-000000000001', true);

select (planning.create_my_session_template(
  '019ec000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  '83111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('e1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

-- Three sets: one warm-up, one normal, one to failure with no reps. That is the shape
-- the screen writes and the whole reason this slice exists.
select (planning.replace_my_session_template_draft(
  '019ec000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"superset_group":1,"target":{"family":"strength","target_rest_seconds":90,"sets":[
       {"set_order":1,"kind":"warmup","target_reps":12},
       {"set_order":2,"kind":"normal","target_reps":8},
       {"set_order":3,"kind":"to_failure"}]}},
     {"position":2,"superset_group":1,"target":{"family":"strength","sets":[
       {"set_order":1,"kind":"normal","target_reps":10},
       {"set_order":2,"kind":"normal","target_reps":10}]}}]}'::jsonb,
  '83111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('e2', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as etag1 \gset

select throws_ok(
  $$ select planning.replace_my_session_template_draft('019ec000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'), planning.content_etag((select content from planning.session_template_drafts where template_id = (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'))), '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","sets":[{"set_order":1,"kind":"to_failure","target_reps":8}]}}]}'::jsonb, '83111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(), decode(repeat('e3', 32), 'hex')) $$,
  '22023', null, 'T-PLN-SETS-01 a set to failure with reps is refused, because it is a contradiction');

select throws_ok(
  $$ select planning.replace_my_session_template_draft('019ec000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'), planning.content_etag((select content from planning.session_template_drafts where template_id = (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'))), '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","sets":[{"set_order":1,"kind":"normal","target_reps":8},{"set_order":3,"kind":"normal","target_reps":8}]}}]}'::jsonb, '83111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(), decode(repeat('e4', 32), 'hex')) $$,
  '22023', null, 'T-PLN-SETS-02 and a set 3 with no set 2 is refused too');

select throws_ok(
  $$ select planning.replace_my_session_template_draft('019ec000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'), planning.content_etag((select content from planning.session_template_drafts where template_id = (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'))), '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":9,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}}]}'::jsonb, '83111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(), decode(repeat('e5', 32), 'hex')) $$,
  '22023', null, 'T-PLN-SETS-03 a summary that disagrees with its own sets is refused rather than recomputed');

select (planning.publish_my_session_template(
  '019ec000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '83111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('e6', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as version_id \gset

select is(
  (select array_agg(planned.kind::text order by planned.set_order)
   from planning.planned_sets as planned
   join planning.planned_steps as step on step.id = planned.planned_step_id
   where step.template_version_id = :'version_id'::uuid and step.position = 1),
  array['warmup', 'normal', 'to_failure'],
  'T-PLN-SETS-04 publishing writes one row per set, in order, with its kind');

select is(
  (select target.target_sets from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id = :'version_id'::uuid and step.position = 1),
  3,
  'T-PLN-SETS-05 and the summary counts them');

-- Three sets of 12, 8 and "as many as you can" do not agree on a number, so there is
-- none to report. A number here would be a lie the whole app would repeat.
select is(
  (select target.target_reps from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id = :'version_id'::uuid and step.position = 1),
  null::integer,
  'T-PLN-SETS-06 with no reps to report when the sets disagree');

select is(
  (select target.target_reps from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id = :'version_id'::uuid and step.position = 2),
  10,
  'T-PLN-SETS-07 and the number when they all agree');

select is(
  (select array_agg(step.superset_group order by step.position)
   from planning.planned_steps as step
   where step.template_version_id = :'version_id'::uuid),
  array[1, 1]::smallint[],
  'T-PLN-SETS-08 the chain travels into the published version');

select is(
  (select target.target_rest_seconds from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id = :'version_id'::uuid and step.position = 1),
  90,
  'T-PLN-SETS-09 and so does the rest it asks for');

-- The negative that matters: a published version is finished. Without the two triggers
-- a set could be added to somebody's routine after they read it.
--
-- The flag is closed first: publishing opened it in this same transaction, and leaving
-- it open would make this assert that publication can publish.
select set_config('app.planning_publication', 'false', true);

select throws_ok(
  $$ insert into planning.planned_sets (planned_step_id, set_order, kind)
     select step.id, 9, 'normal' from planning.planned_steps as step
     where step.position = 1 limit 1 $$,
  '55000', null, 'T-PLN-SETS-10 no set is added to a published version afterwards');

select throws_ok(
  $$ update planning.planned_sets set target_reps = 99 where set_order = 1 $$,
  '55000', null, 'T-PLN-SETS-11 nor edited');

select is(
  (planning.read_my_session_template_draft(
    '019ec000-0000-7000-8000-000000000001', :'template_id'::uuid)->'content'->>'title'),
  'Empuje',
  'T-PLN-SETS-12 a draft can be read back in the shape it is edited in');

-- Read as the neighbour, with her own actor context: the guard compares the person
-- asking against the session, so passing a different id from the same session is not
-- the thing being tested.
select set_config('app.actor_person_id', '019ec000-0000-7000-8000-000000000002', true);

select is(
  planning.read_my_session_template_draft(
    '019ec000-0000-7000-8000-000000000002', :'template_id'::uuid),
  null::jsonb,
  'T-PLN-SETS-13 and the neighbour reads nothing, the same answer as one that never existed');

-- Discarding a routine that has already been published would orphan programmes and
-- assignments that point at its version.
select set_config('app.actor_person_id', '019ec000-0000-7000-8000-000000000001', true);

select throws_ok(
  $$ select planning.discard_my_session_template('019ec000-0000-7000-8000-000000000001', (select id from planning.session_templates where owner_person_id = '019ec000-0000-7000-8000-000000000001'), '83111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(), decode(repeat('e7', 32), 'hex')) $$,
  '23514', null, 'T-PLN-SETS-14 a routine with a published version is not discarded');

select (planning.create_my_session_template(
  '019ec000-0000-7000-8000-000000000001', 'test_strength', 'Para tirar',
  '83111111-1111-4111-8111-111111111108', extensions.uuid_generate_v7(),
  decode(repeat('e8', 32), 'hex'))).template as throwaway \gset
select (:'throwaway'::jsonb->>'id') as throwaway_id \gset

select (planning.discard_my_session_template(
  '019ec000-0000-7000-8000-000000000001', :'throwaway_id'::uuid,
  '83111111-1111-4111-8111-111111111109', extensions.uuid_generate_v7(),
  decode(repeat('e9', 32), 'hex'))).template as discarded \gset

-- A state, not a deletion: the row is still there and the draft with it.
select is(
  (select count(*)::integer from planning.session_template_drafts
   where template_id = :'throwaway_id'::uuid),
  1,
  'T-PLN-SETS-15 discarding deletes nothing; the draft row stays where it was');

select is(
  (select count(*)::integer
   from jsonb_array_elements(planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as listed
   where listed->>'template_id' = :'throwaway_id'),
  0,
  'T-PLN-SETS-16 and it is gone from my content, which is what discarding means');

select * from finish();
rollback;
