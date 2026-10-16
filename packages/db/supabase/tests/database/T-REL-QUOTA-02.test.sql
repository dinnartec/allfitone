-- T-REL-QUOTA-02 — OP-IDN-009 against the guest quota (`HU-STUDIO-087`, criterion 5).
--
-- Accepting an invitation takes no place that was not already taken. The invitation
-- being answered is pending and unexpired, which is exactly what occupies a place;
-- accepting turns it into an active relationship, which occupies one too. So the
-- occupancy before and after an acceptance is the same figure, and the place was
-- reserved when the invitation was issued.
--
-- That is why acceptance carries no quota check, and why this file exists: nobody may
-- later add one without these assertions saying so. The only case such a check could
-- ever refuse is a gym that Allfit cut below what it holds, and refusing a person
-- mid-flight for that would end an offer the gym legitimately made, which is what
-- criterion 6 forbids Allfit's change from doing.
--
-- Both ends are asserted: a gym exactly at its quota and a gym over it. Each time the
-- acceptance succeeds, the occupancy figure is identical, and nothing is half-done:
-- the relationship, the consent record, the grant and the closed invitation all exist.

begin;

select plan(16);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3100-0000-7000-8000-000000000001', 'Ana', 'Client', 'active'),
  ('019b3100-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019b3100-0000-7000-8000-000000000021', 'Xavier', 'First', 'active'),
  ('019b3100-0000-7000-8000-000000000022', 'Yolanda', 'Second', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019b3100-0000-7000-8000-000000000101', 'gym', 'Accept Gym',
  '{"party_kind":"legal_entity","party_name":"Accept SAS","purpose":"studio_operations"}');
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b3100-0000-7000-8000-000000000201', '019b3100-0000-7000-8000-000000000101',
  '019b3100-0000-7000-8000-000000000011', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019b3100-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019b3100-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp());

insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b3100-0000-7000-8000-000000000401', '019b3100-0000-7000-8000-000000000001',
  '019b3100-0000-7000-8000-000000000101', 'active');

-- One relationship and two invitations out: three places of three.
update organizations.organizations set guest_quota_seats = 3
where id = '019b3100-0000-7000-8000-000000000101';

create function pg_temp.invite(p_email text, p_n integer)
returns void
language sql
as $$
  select issued.invitation_id
  from identity.issue_client_invitation(
    '019b3100-0000-7000-8000-000000000011', '019b3100-0000-7000-8000-000000000101',
    'email', p_email,
    '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
       "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
    extensions.digest('token-' || p_email, 'sha256'), 1::smallint,
    ('019b3100-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    ('019b3100-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    extensions.digest('request-' || p_n::text, 'sha256')
  ) as issued
$$;

create function pg_temp.accept(p_person uuid, p_email text, p_n integer)
returns void
language sql
as $$
  select decided.invitation_id
  from identity.decide_client_invitation(
    p_person,
    extensions.digest('token-' || p_email, 'sha256'),
    (select intent.id from identity.invitation_intents as intent
       join identity.invitations as invitation on invitation.id = intent.invitation_id
       where invitation.contact::text = p_email and intent.kind = 'service_relationship'),
    'accepted', '{"body_progress":"accepted"}'::jsonb,
    ('019b3100-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    ('019b3100-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    extensions.digest('request-' || p_n::text, 'sha256')
  ) as decided
$$;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3100-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019b3100-0000-7000-8000-000000000101', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select pg_temp.invite('x1@example.test', 9001);
select pg_temp.invite('x2@example.test', 9002);

select is(
  (select occupied from organizations.organization_guest_occupancy('019b3100-0000-7000-8000-000000000101')),
  3,
  'the gym is exactly at its quota'
);

-- At the quota: the first person accepts.
select set_config('app.actor_person_id', '019b3100-0000-7000-8000-000000000021', true),
       set_config('app.actor_verified_email', 'x1@example.test', true);
select lives_ok(
  $$select pg_temp.accept('019b3100-0000-7000-8000-000000000021', 'x1@example.test', 9101)$$,
  'a person accepts an invitation to a gym that is exactly at its quota'
);

select set_config('app.actor_person_id', '019b3100-0000-7000-8000-000000000011', true);
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3100-0000-7000-8000-000000000101')),
  3,
  'the occupancy is the same after the acceptance: the invitation became a relationship'
);
select is(
  (select relationships_active from organizations.organization_guest_occupancy('019b3100-0000-7000-8000-000000000101')),
  2,
  'one place moved from an invitation to a relationship'
);
select is(
  (select count(*) from relationships.service_relationships
   where person_id = '019b3100-0000-7000-8000-000000000021' and status = 'active'),
  1::bigint,
  'and the relationship exists'
);
select is(
  (select count(*) from privacy.data_grants
   where person_id = '019b3100-0000-7000-8000-000000000021' and status = 'active'),
  1::bigint,
  'with the grant that was accepted'
);
select is(
  (select invitation.status::text from identity.invitations as invitation
   where invitation.contact::text = 'x1@example.test'),
  'completed',
  'and the invitation is closed, so nothing was left half-done'
);

-- Allfit now cuts the quota far below what the gym holds.
update organizations.organizations set guest_quota_seats = 1
where id = '019b3100-0000-7000-8000-000000000101';

select is(
  (organizations.guest_quota_projection('019b3100-0000-7000-8000-000000000101')->>'over_quota')::boolean,
  true,
  'the gym is over its quota'
);

-- Over the quota: the second person, mid-flight, still accepts.
select set_config('app.actor_person_id', '019b3100-0000-7000-8000-000000000022', true),
       set_config('app.actor_verified_email', 'x2@example.test', true);
select lives_ok(
  $$select pg_temp.accept('019b3100-0000-7000-8000-000000000022', 'x2@example.test', 9102)$$,
  'a person accepts an invitation to a gym that Allfit put over its quota'
);

select set_config('app.actor_person_id', '019b3100-0000-7000-8000-000000000011', true);
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3100-0000-7000-8000-000000000101')),
  3,
  'the occupancy is still the same figure, over the quota or not'
);
select is(
  (select relationships_active from organizations.organization_guest_occupancy('019b3100-0000-7000-8000-000000000101')),
  3,
  'both invitations are now relationships'
);
select is(
  (select count(*) from relationships.service_relationships
   where person_id = '019b3100-0000-7000-8000-000000000022' and status = 'active'),
  1::bigint,
  'and the second relationship exists'
);
select is(
  (select count(*) from identity.invitations
   where organization_id = '019b3100-0000-7000-8000-000000000101' and status = 'pending'),
  0::bigint,
  'with no invitation left pending'
);
select is(
  (select count(*) from privacy.consent_events
   where person_id in ('019b3100-0000-7000-8000-000000000021',
                       '019b3100-0000-7000-8000-000000000022')),
  2::bigint,
  'and each acceptance recorded its consent'
);
select is(
  (select count(*) from relationships.service_relationships
   where organization_id = '019b3100-0000-7000-8000-000000000101' and status = 'active'),
  3::bigint,
  'lowering the quota ended no relationship'
);

-- The door stays closed to anybody new, which is the only thing a lower quota does.
select throws_ok(
  $$select pg_temp.invite('x3@example.test', 9003)$$,
  '55000',
  'the gym has no places left in its guest quota',
  'an over-quota gym still invites nobody new'
);

select * from finish();

rollback;
