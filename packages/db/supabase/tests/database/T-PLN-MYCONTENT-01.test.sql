-- What I have made, read back.
--
-- `planning.read_my_content` answers two questions with one list: which of my routines
-- exist, and which of them can go in a programme. A draft is a routine and is not
-- composable, so it comes back with `template_version_id` null; a published routine
-- comes back with the id of its newest published version, which is the thing a
-- programme session points at.
--
-- The counts are the part worth testing hardest. They must describe the **published**
-- version and never the draft, because a programme is composed of what was published:
-- so this file publishes a routine of one exercise and four sets, then edits the draft
-- to two exercises, and asserts the row still says one and four. A row mixing a version
-- id with the draft's numbers would describe two different routines at once.
--
-- The neighbour pair was written first and watched failing against a copy of the
-- function with `where template.owner_person_id = p_person_id` removed: without it the
-- neighbour's list came back with both of my routines in it. With the clause present
-- her list is empty, and empty is `'[]'::jsonb` and not null, because the screen
-- renders a list and cannot render null.
--
-- `T-PLN-MYCONTENT-06` is wrapped in a TODO. It asserts what the function promises —
-- nothing is unpublished the moment you publish — and it does not hold: nothing in the
-- pipeline ever sets the draft's `derived_from_version_id`, so the flag is true forever
-- after the first publish. The assertion is written at full strength and left failing
-- rather than adjusted to the behaviour; see the report for the detail.

begin;

select plan(10);

insert into identity.people (id, given_name, family_name)
values
  ('019ec000-0000-7000-8000-000000000001', 'Autora', 'Propia'),
  ('019ec000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ec000-0000-7000-8000-000000000001', true);

-- The older of the two: created and never published, so it stays a draft.
select (planning.create_my_session_template(
  '019ec000-0000-7000-8000-000000000001', 'test_strength', 'Solo borrador',
  '82c11111-1111-4111-8111-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('c1', 32), 'hex'))).template as draft_only \gset
select (:'draft_only'::jsonb->>'id') as draft_template_id \gset

select (planning.create_my_session_template(
  '019ec000-0000-7000-8000-000000000001', 'test_strength', 'Publicada',
  '82c11111-1111-4111-8111-000000000002', extensions.uuid_generate_v7(),
  decode(repeat('c2', 32), 'hex'))).template as published_created \gset
select (:'published_created'::jsonb->>'id') as published_template_id,
       (:'published_created'::jsonb->'draft'->>'etag') as etag0 \gset

-- One exercise of four sets. These are the numbers the published row must keep saying.
select (planning.replace_my_session_template_draft(
  '019ec000-0000-7000-8000-000000000001', :'published_template_id'::uuid, :'etag0',
  '{"title":"Publicada","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8,"target_rest_seconds":90}}]}'::jsonb,
  '82c11111-1111-4111-8111-000000000003', extensions.uuid_generate_v7(),
  decode(repeat('c3', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ec000-0000-7000-8000-000000000001', :'published_template_id'::uuid, :'etag1',
  '82c11111-1111-4111-8111-000000000004', extensions.uuid_generate_v7(),
  decode(repeat('c4', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as version_id \gset

-- Written before anything else: the ownership filter is the whole security of this read.
select is(
  (select count(*)::integer from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000002')) as neighbour(item)
   where neighbour.item->>'template_id' in (:'draft_template_id', :'published_template_id')),
  0,
  'T-PLN-MYCONTENT-01 a neighbour does not read the routines I made');

select is(
  planning.read_my_content('019ec000-0000-7000-8000-000000000002'),
  '[]'::jsonb,
  'T-PLN-MYCONTENT-02 and a person with nothing gets an empty list, not null');

select is(
  jsonb_array_length(planning.read_my_content('019ec000-0000-7000-8000-000000000001')),
  2,
  'T-PLN-MYCONTENT-03 my list holds both the draft and the published routine');

-- A draft is a routine and is not composable: it exists, and it has no version to point at.
select is(
  (select jsonb_typeof(mine.item->'template_version_id') from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'draft_template_id'),
  'null',
  'T-PLN-MYCONTENT-04 a routine with only a draft comes back without a version id');

select is(
  (select mine.item->>'template_version_id' from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'published_template_id'),
  :'version_id',
  'T-PLN-MYCONTENT-05 a published routine comes back with its published version id');

-- Asserted before the draft is touched: publishing is the moment nothing is unpublished.
select is(
  (select mine.item->>'has_unpublished_changes' from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'published_template_id'),
  'false',
  'T-PLN-MYCONTENT-06 and nothing unpublished right after publishing');

-- The published routine was published after the draft-only one was saved.
select is(
  (select jsonb_agg(mine.item->>'title' order by mine.position)
   from jsonb_array_elements(planning.read_my_content('019ec000-0000-7000-8000-000000000001'))
     with ordinality as mine(item, position)),
  '["Publicada", "Solo borrador"]'::jsonb,
  'T-PLN-MYCONTENT-07 and the newest routine comes first');

-- Two exercises in the draft now. The published version still has one.
select (planning.replace_my_session_template_draft(
  '019ec000-0000-7000-8000-000000000001', :'published_template_id'::uuid, :'etag1',
  '{"title":"Publicada","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8,"target_rest_seconds":90}},{"position":2,"target":{"family":"strength","target_sets":3,"target_reps":10,"target_rest_seconds":60}}]}'::jsonb,
  '82c11111-1111-4111-8111-000000000005', extensions.uuid_generate_v7(),
  decode(repeat('c5', 32), 'hex'))).draft as edited \gset

select is(
  (select (mine.item->>'exercise_count')::integer from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'published_template_id'),
  1,
  'T-PLN-MYCONTENT-08 the exercise count describes the published version, not the draft');

select is(
  (select (mine.item->>'set_count')::integer from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'published_template_id'),
  4,
  'T-PLN-MYCONTENT-09 and so does the set count');

select is(
  (select mine.item->>'has_unpublished_changes' from jsonb_array_elements(
     planning.read_my_content('019ec000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'published_template_id'),
  'true',
  'T-PLN-MYCONTENT-10 and editing the draft of a published routine is an unpublished change');

select * from finish();
rollback;
