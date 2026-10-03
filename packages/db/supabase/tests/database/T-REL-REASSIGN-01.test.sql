-- T-REL-REASSIGN-01 — OP-REL-003.
--
-- Cambiar de responsable, y las tres cosas que lo separan de asignar.
--
-- La aserción que más pesa es la del evento: la notificación es una fila del
-- outbox escrita por la propia función, así que existe dentro de esta misma
-- transacción. Ese es el criterio 4, y se comprueba viendo que está — si
-- alguien mueve el aviso fuera de la función, esto se cae.
--
-- Las otras dos: el permiso de la persona sobrevive intacto, porque no cambió
-- nada de lo que el permiso registra; y el profesional anterior pierde el
-- acceso de inmediato pero conserva su fila, que es su autoría.

begin;

select plan(16);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c3000-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active', 'ana@example.test'),
  ('019c3000-0000-7000-8000-000000000002', 'Bruno', 'Cliente', 'active', 'bruno@example.test'),
  ('019c3000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active', null),
  ('019c3000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active', null),
  ('019c3000-0000-7000-8000-000000000013', 'Diana', 'Coach', 'active', null),
  ('019c3000-0000-7000-8000-000000000014', 'Sara', 'Staff', 'active', null);

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019c3000-0000-7000-8000-000000000101', 'gym', 'Reassign Gym',
  '{"party_kind":"legal_entity","party_name":"Reassign SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c3000-0000-7000-8000-000000000201', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000011', 'active'),
  ('019c3000-0000-7000-8000-000000000202', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000012', 'active'),
  ('019c3000-0000-7000-8000-000000000203', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000013', 'active'),
  ('019c3000-0000-7000-8000-000000000204', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000014', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c3000-0000-7000-8000-000000000201', 'owner'),
  ('019c3000-0000-7000-8000-000000000202', 'coach'),
  ('019c3000-0000-7000-8000-000000000203', 'coach'),
  ('019c3000-0000-7000-8000-000000000204', 'staff');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000101', 'active'),
  -- Bruno, sin titular: cambiar no es asignar, y esta relación lo demuestra.
  -- Es otra persona porque `uidx_service_relationships_active` admite una sola
  -- relación activa por persona y organización.
  ('019c3000-0000-7000-8000-000000000702', '019c3000-0000-7000-8000-000000000002',
    '019c3000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values (
  '019c3000-0000-7000-8000-000000000801', '019c3000-0000-7000-8000-000000000701',
  '019c3000-0000-7000-8000-000000000001', '019c3000-0000-7000-8000-000000000101',
  '019c3000-0000-7000-8000-000000000202', 'holder', 'active'
);

-- El permiso que tiene que sobrevivir intacto (criterio 1).
insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019c3000-0000-7000-8000-000000000301', 'health_context', 1, 'published', clock_timestamp());

insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values (
  '019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000101',
  '019c3000-0000-7000-8000-000000000201', 'email', 'ana@example.test',
  extensions.digest('reassign-token', 'sha256'), 1,
  extensions.digest('reassign-proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"Reassign SAS","purpose":"studio_operations"}',
  'completed', clock_timestamp() + interval '7 days'
);

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values ('019c3000-0000-7000-8000-000000000501', '019c3000-0000-7000-8000-000000000401',
  'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values (
  '019c3000-0000-7000-8000-000000000601', '019c3000-0000-7000-8000-000000000501',
  '019c3000-0000-7000-8000-000000000301', 'health_context', 'read',
  'Adaptar el entrenamiento', '{"title":"Contexto de salud"}'::jsonb,
  'accepted', clock_timestamp()
);

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot
) values (
  '019c3000-0000-7000-8000-000000000901', '019c3000-0000-7000-8000-000000000001',
  '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000101',
  '019c3000-0000-7000-8000-000000000601', '019c3000-0000-7000-8000-000000000301',
  'health_context', 'accepted', '{"title":"Contexto de salud"}'::jsonb
);

insert into privacy.data_grants (
  id, person_id, relationship_id, organization_id, scope_definition_id, scope_code,
  consent_event_id, access_level, purpose
) values (
  '019c3000-0000-7000-8000-000000000a01', '019c3000-0000-7000-8000-000000000001',
  '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000101',
  '019c3000-0000-7000-8000-000000000301', 'health_context',
  '019c3000-0000-7000-8000-000000000901', 'read', 'Adaptar el entrenamiento'
);

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- El owner pasa la relación de Camilo a Diana.
select is(
  (select reassigned from relationships.reassign_relationship_holder(
    '019c3000-0000-7000-8000-000000000011', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000203',
    '019c3000-0000-7000-8000-000000000f01', '019c3000-0000-7000-8000-000000000f01',
    extensions.digest('reassign-1', 'sha256'))),
  true,
  'un owner cambia el profesional responsable'
);

select is(
  (select membership_id from relationships.relationship_professional_assignments
   where relationship_id = '019c3000-0000-7000-8000-000000000701'
     and kind = 'holder' and status = 'active'),
  '019c3000-0000-7000-8000-000000000203'::uuid,
  'y ahora la atiende Diana'
);

/*
 * Criterio 4, la que más pesa. El aviso es una fila del outbox escrita por la
 * propia función, así que ya existe dentro de esta transacción: no hay camino
 * donde la reasignación se confirme y el aviso no.
 */
select is(
  (select count(*)::int from system.outbox_events
   where event_type = 'relationship.professional_reassigned.v1'
     and aggregate_id = '019c3000-0000-7000-8000-000000000701'),
  1,
  'la notificación queda encolada en la misma transacción'
);

select is(
  (select (payload ->> 'person_id')::uuid from system.outbox_events
   where event_type = 'relationship.professional_reassigned.v1'
     and aggregate_id = '019c3000-0000-7000-8000-000000000701'),
  '019c3000-0000-7000-8000-000000000001'::uuid,
  'y dice a quién hay que avisar: a la persona, no al gimnasio'
);

-- El aviso tiene que poder redactarse sin volver a la base de datos, porque el
-- worker no puede leer relaciones ni personas: esas políticas existen para
-- mantenerlas fuera de su alcance.
select is(
  (select payload ->> 'contact' from system.outbox_events
   where event_type = 'relationship.professional_reassigned.v1'),
  'ana@example.test',
  'el evento lleva a dónde va el aviso'
);

select is(
  (select (payload ->> 'previous_professional_name') || ' → ' || (payload ->> 'professional_name')
   from system.outbox_events
   where event_type = 'relationship.professional_reassigned.v1'),
  'Camilo Coach → Diana Coach',
  'y quién dejaba de atenderla y quién empieza'
);

-- Criterio 1: el permiso sobrevive intacto. No cambió nada de lo que registra.
select is(
  (select count(*)::int from privacy.data_grants
   where relationship_id = '019c3000-0000-7000-8000-000000000701'
     and status = 'active'),
  1,
  'el permiso de la persona sigue vigente después de cambiar de profesional'
);

select is(
  (select scope_code from privacy.data_grants
   where relationship_id = '019c3000-0000-7000-8000-000000000701'),
  'health_context',
  'y es el mismo permiso, no uno nuevo que haya que volver a pedir'
);

-- Criterio 2: Camilo pierde el acceso de inmediato…
select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000012', true);

select is(
  (select relationships.actor_is_assigned('019c3000-0000-7000-8000-000000000701')),
  false,
  'el profesional anterior deja de estar asignado en el acto'
);

select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000013', true);

select is(
  (select relationships.actor_is_assigned('019c3000-0000-7000-8000-000000000701')),
  true,
  'y el nuevo lo está'
);

select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000011', true);

-- …pero conserva su fila, que es la autoría de lo que registró.
select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where id = '019c3000-0000-7000-8000-000000000801' and status = 'ended'),
  1,
  'la asignación anterior queda cerrada, nunca borrada'
);

-- Cambiar a quien ya atiende no escribe ni avisa: un aviso diciendo que el
-- profesional cambió al mismo profesional enseña a ignorar los de verdad.
select is(
  (select reassigned from relationships.reassign_relationship_holder(
    '019c3000-0000-7000-8000-000000000011', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000203',
    '019c3000-0000-7000-8000-000000000f02', '019c3000-0000-7000-8000-000000000f02',
    extensions.digest('reassign-2', 'sha256'))),
  false,
  'cambiar al que ya atiende no es un cambio'
);

select is(
  (select count(*)::int from system.outbox_events
   where event_type = 'relationship.professional_reassigned.v1'),
  1,
  'y no manda un segundo aviso'
);

-- El límite con OP-REL-002, en el otro sentido.
select throws_ok(
  $$select * from relationships.reassign_relationship_holder(
    '019c3000-0000-7000-8000-000000000011', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000702', '019c3000-0000-7000-8000-000000000203',
    '019c3000-0000-7000-8000-000000000f03', '019c3000-0000-7000-8000-000000000f03',
    extensions.digest('reassign-3', 'sha256'))$$,
  'P0004',
  'this relationship has no holder to change; assigning one is a separate operation',
  'una relación sin titular no se reasigna: se asigna'
);

-- Criterio 1 de HU-027, que esta operación también debe respetar.
select throws_ok(
  $$select * from relationships.reassign_relationship_holder(
    '019c3000-0000-7000-8000-000000000011', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000204',
    '019c3000-0000-7000-8000-000000000f04', '019c3000-0000-7000-8000-000000000f04',
    extensions.digest('reassign-4', 'sha256'))$$,
  '42501',
  'a holder must be an active coach of this organization',
  'tampoco se puede reasignar a alguien que no es coach'
);

-- Un coach no reparte responsables, ni siquiera para quitarse uno de encima.
select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000013', true);

select throws_ok(
  $$select * from relationships.reassign_relationship_holder(
    '019c3000-0000-7000-8000-000000000013', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000701', '019c3000-0000-7000-8000-000000000202',
    '019c3000-0000-7000-8000-000000000f05', '019c3000-0000-7000-8000-000000000f05',
    extensions.digest('reassign-5', 'sha256'))$$,
  '42501',
  'reassigning a professional requires assign_professionals',
  'un coach no se pasa un cliente a otro coach'
);

select * from finish();

rollback;
