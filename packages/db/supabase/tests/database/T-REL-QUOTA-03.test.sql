-- T-REL-QUOTA-03 — the guest quota as Studio reads it (`HU-STUDIO-087`, criteria 1 and 2).
--
-- A gym sees how many places are taken and how many are left, and nothing about who
-- decided its number: `last_change` carries the Allfit staff member who set it, which
-- the gym must never learn, so the read has no such column at all. A person with no
-- seat at the gym reads nothing, and a gym with no quota says so with an absent figure
-- rather than a zero, because zero places left would read as a gym that cannot invite.

begin;

select plan(8);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3200-0000-7000-8000-000000000001', 'Ana', 'Client', 'active'),
  ('019b3200-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019b3200-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019b3200-0000-7000-8000-000000000013', 'Xiomara', 'Outsider', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019b3200-0000-7000-8000-000000000101', 'gym', 'Read Gym',
    '{"party_kind":"legal_entity","party_name":"Read SAS","purpose":"studio_operations"}'),
  ('019b3200-0000-7000-8000-000000000102', 'gym', 'Free Gym',
    '{"party_kind":"legal_entity","party_name":"Free SAS","purpose":"studio_operations"}');
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019b3200-0000-7000-8000-000000000201', '019b3200-0000-7000-8000-000000000101',
    '019b3200-0000-7000-8000-000000000011', 'active'),
  ('019b3200-0000-7000-8000-000000000202', '019b3200-0000-7000-8000-000000000101',
    '019b3200-0000-7000-8000-000000000012', 'active'),
  ('019b3200-0000-7000-8000-000000000203', '019b3200-0000-7000-8000-000000000102',
    '019b3200-0000-7000-8000-000000000011', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values
  ('019b3200-0000-7000-8000-000000000201', 'owner'),
  ('019b3200-0000-7000-8000-000000000202', 'coach'),
  ('019b3200-0000-7000-8000-000000000203', 'owner');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b3200-0000-7000-8000-000000000401', '019b3200-0000-7000-8000-000000000001',
  '019b3200-0000-7000-8000-000000000101', 'active');

update organizations.organizations set guest_quota_seats = 3
where id = '019b3200-0000-7000-8000-000000000101';

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3200-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019b3200-0000-7000-8000-000000000101', true);

select results_eq(
  $$select seats, occupied, places_left, over_quota
    from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000101')$$,
  $$values (3, 1, 2, false)$$,
  'the owner reads the seats, what is taken and what is left'
);

-- Whoever invites must be able to be told why before trying, a coach included.
select set_config('app.actor_person_id', '019b3200-0000-7000-8000-000000000012', true);
select results_eq(
  $$select seats, occupied, places_left, over_quota
    from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000101')$$,
  $$values (3, 1, 2, false)$$,
  'a coach with no assignment reads the same whole-gym figure'
);

-- Nothing about who set the number is part of the answer.
select is(
  (select array_agg(arg order by ordinality)
   from pg_proc as proc,
        unnest(proc.proargnames, proc.proargmodes::text[]) with ordinality as args(arg, mode, ordinality)
   where proc.oid = 'organizations.studio_guest_quota(uuid)'::regprocedure
     and args.mode = 't'),
  array['seats', 'occupied', 'places_left', 'over_quota'],
  'the columns are the four figures and carry no last_change, no actor, no duty'
);

-- A person with no seat at this gym reads nothing, whatever they claim.
select set_config('app.actor_person_id', '019b3200-0000-7000-8000-000000000013', true);
select throws_ok(
  $$select * from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000101')$$,
  '42501',
  'guest quota requires a directory or invitation capability',
  'an outsider cannot read the gym''s quota'
);

-- Without any actor, closed.
select set_config('app.actor_kind', '', true), set_config('app.actor_person_id', '', true);
select throws_ok(
  $$select * from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000101')$$,
  '42501',
  'a person actor is required',
  'with no actor the read is closed, not open'
);

-- Another gym's figure is not readable with this gym's seat.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3200-0000-7000-8000-000000000012', true);
select throws_ok(
  $$select * from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000102')$$,
  '42501',
  'guest quota requires a directory or invitation capability',
  'a seat at one gym is not a seat at another'
);

-- No quota is an absent figure, never zero.
select set_config('app.actor_person_id', '019b3200-0000-7000-8000-000000000011', true);
select results_eq(
  $$select seats, occupied, places_left, over_quota
    from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000102')$$,
  $$values (null::integer, 0, null::integer, false)$$,
  'a gym with no quota has no seats and no places-left figure, and is not over'
);

-- Over the quota: nothing is left, and the gym is told it is over.
update organizations.organizations set guest_quota_seats = 1
where id = '019b3200-0000-7000-8000-000000000101';
insert into identity.people (id, given_name, family_name, status)
values ('019b3200-0000-7000-8000-000000000002', 'Bruno', 'Client', 'active');
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b3200-0000-7000-8000-000000000402', '019b3200-0000-7000-8000-000000000002',
  '019b3200-0000-7000-8000-000000000101', 'active');

select results_eq(
  $$select seats, occupied, places_left, over_quota
    from organizations.studio_guest_quota('019b3200-0000-7000-8000-000000000101')$$,
  $$values (1, 2, 0, true)$$,
  'over its quota a gym has no places left and is told it is over, never a negative'
);

select * from finish();

rollback;
