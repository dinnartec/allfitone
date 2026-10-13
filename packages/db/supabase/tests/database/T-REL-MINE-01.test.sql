-- T-REL-MINE-01 — `OP-REL-012`, the relationships a person has and had.
--
-- The function has no `where person_id =` in it: the row policy on
-- `service_relationships` is what narrows the answer. So the only assertion that matters
-- here is that the narrowing happens — and that it happens under `allfit_owner`, which is
-- the role the function runs as and which does not bypass row-level security.
--
-- Also asserted: closed relationships are included, because somebody who left and came
-- back has a history worth showing, and the link between the two is a fact about her past
-- rather than a key to it.

begin;

select plan(9);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c6000-0000-7000-8000-000000000001', 'Carla', 'Cliente', 'active'),
  ('019c6000-0000-7000-8000-000000000002', 'Dora', 'Cliente', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c6000-0000-7000-8000-000000000101', 'gym', 'Gimnasio Uno',
   '{"party_kind":"legal_entity","party_name":"Uno SAS","purpose":"studio_operations"}'),
  ('019c6000-0000-7000-8000-000000000102', 'gym', 'Gimnasio Dos',
   '{"party_kind":"legal_entity","party_name":"Dos SAS","purpose":"studio_operations"}');

-- Carla left gym one and came back, and also trains at gym two. Dora trains at gym one
-- and is the person whose rows must never appear.
insert into relationships.service_relationships
  (id, person_id, organization_id, status, started_at, ended_at, ended_by_kind)
values
  ('019c6000-0000-7000-8000-000000000201', '019c6000-0000-7000-8000-000000000001',
   '019c6000-0000-7000-8000-000000000101', 'terminated',
   clock_timestamp() - interval '400 days', clock_timestamp() - interval '200 days', 'person'),
  ('019c6000-0000-7000-8000-000000000203', '019c6000-0000-7000-8000-000000000001',
   '019c6000-0000-7000-8000-000000000102', 'active',
   clock_timestamp() - interval '100 days', null, null),
  ('019c6000-0000-7000-8000-000000000204', '019c6000-0000-7000-8000-000000000002',
   '019c6000-0000-7000-8000-000000000101', 'active',
   clock_timestamp() - interval '50 days', null, null);

-- The return, pointing at the one she had before with the same gym.
insert into relationships.service_relationships
  (id, person_id, organization_id, status, previous_relationship_id, started_at)
values
  ('019c6000-0000-7000-8000-000000000202', '019c6000-0000-7000-8000-000000000001',
   '019c6000-0000-7000-8000-000000000101', 'active',
   '019c6000-0000-7000-8000-000000000201', clock_timestamp() - interval '10 days');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c6000-0000-7000-8000-000000000001', true);

select is(
  (select count(*)::integer from relationships.list_my_relationships(
    '019c6000-0000-7000-8000-000000000001', 50, null, null)),
  3,
  'she reads her three relationships and not the fourth, which is somebody else''s'
);

select is(
  (select string_agg(organization_name, ', ' order by started_at desc)
   from relationships.list_my_relationships(
     '019c6000-0000-7000-8000-000000000001', 50, null, null)),
  'Gimnasio Uno, Gimnasio Dos, Gimnasio Uno',
  'each one named, newest first, with the same gym appearing twice'
);

select is(
  (select count(*)::integer from relationships.list_my_relationships(
    '019c6000-0000-7000-8000-000000000001', 50, null, null)
   where status = 'terminated'),
  1,
  'the one she ended is included, because leaving is part of her history'
);

select is(
  (select previous_relationship_id from relationships.list_my_relationships(
    '019c6000-0000-7000-8000-000000000001', 50, null, null)
   where relationship_id = '019c6000-0000-7000-8000-000000000202'),
  '019c6000-0000-7000-8000-000000000201'::uuid,
  'and the return points at what came before, which is a fact and not a key'
);

-- The page the cursor produces, and the proof that it moves forward rather than
-- repeating. One row at a time is the shape that breaks a cursor if it is wrong.
select is(
  (select relationship_id from relationships.list_my_relationships(
    '019c6000-0000-7000-8000-000000000001', 1, null, null)),
  '019c6000-0000-7000-8000-000000000202'::uuid,
  'the first page is the newest relationship'
);

select is(
  (select relationship_id from relationships.list_my_relationships(
    '019c6000-0000-7000-8000-000000000001', 1,
    (select started_at from relationships.service_relationships
      where id = '019c6000-0000-7000-8000-000000000202'),
    '019c6000-0000-7000-8000-000000000202')),
  '019c6000-0000-7000-8000-000000000203'::uuid,
  'and the next page starts after it, never at the top again'
);

select throws_ok(
  $$ select * from relationships.list_my_relationships(
       '019c6000-0000-7000-8000-000000000001', 1,
       clock_timestamp(), null) $$,
  '22023',
  'invalid relationship cursor',
  'half a cursor is refused rather than read as none at all'
);

select throws_ok(
  $$ select * from relationships.list_my_relationships(
       '019c6000-0000-7000-8000-000000000001', 500, null, null) $$,
  '22023',
  'invalid page limit',
  'and a page nobody asked for is refused too'
);

/*
 * Acting as Dora, asking for Carla. The function refuses before it reads anything: the
 * actor and the argument must be the same person, so a client that sent somebody else's
 * id gets an error rather than an empty list it might mistake for "she has none".
 */
select set_config('app.actor_person_id', '019c6000-0000-7000-8000-000000000002', true);

select throws_ok(
  $$ select * from relationships.list_my_relationships(
       '019c6000-0000-7000-8000-000000000001', 50, null, null) $$,
  '42501',
  'person actor mismatch',
  'and asking about somebody else is refused, not answered emptily'
);

reset role;

select * from finish();

rollback;
