-- T-PRV-SCOPES-01 — OP-PRV-023.
--
-- Qué nos autorizó cada persona, a través de los clientes de la organización.
--
-- La aserción que más pesa es la del coach. La política de `privacy.data_grants`
-- estrecha a la organización —`person_id = person() or organization_id = org()`—
-- y no al profesional asignado. En la ficha de un vínculo eso no importa: la
-- proyección de permisos solo se alcanza después de que el vínculo pasó su
-- propia guarda. En un registro a través de clientes sí importa, porque leer
-- `data_grants` sola le entregaría a un coach lo que autorizaron clientes que
-- no son suyos. El filtro tiene que salir de la política del vínculo, que es la
-- que sabe de asignación.
--
-- La segunda que pesa es el conjunto exacto de columnas. El criterio 3 dice que
-- saber que alguien autorizó su contexto de salud no es leer su contexto de
-- salud, y eso no se comprueba leyendo lo que la fila trae: se comprueba
-- fijándolo, para que el día que alguien añada una columna con contenido este
-- test se caiga.

begin;

select plan(12);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c3000-0000-7000-8000-000000000001', 'Ana', 'Asignada', 'active'),
  ('019c3000-0000-7000-8000-000000000002', 'Bruno', 'Ajeno', 'active'),
  ('019c3000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019c3000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019c3000-0000-7000-8000-000000000015', 'Elena', 'Ajena', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c3000-0000-7000-8000-000000000101', 'gym', 'Scopes Gym',
    '{"party_kind":"legal_entity","party_name":"Scopes SAS","purpose":"studio_operations"}'),
  ('019c3000-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c3000-0000-7000-8000-000000000201', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000011', 'active'),
  ('019c3000-0000-7000-8000-000000000202', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000012', 'active'),
  ('019c3000-0000-7000-8000-000000000205', '019c3000-0000-7000-8000-000000000102',
    '019c3000-0000-7000-8000-000000000015', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c3000-0000-7000-8000-000000000201', 'owner'),
  ('019c3000-0000-7000-8000-000000000202', 'coach'),
  ('019c3000-0000-7000-8000-000000000205', 'owner');

-- Versión 3 a propósito: el registro dice en qué versión se concedió, y una
-- versión 1 pasaría igual si la función devolviera un literal.
insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019c3000-0000-7000-8000-000000000301', 'health_context', 3, 'published', clock_timestamp()),
  ('019c3000-0000-7000-8000-000000000302', 'body_progress', 3, 'published', clock_timestamp());

-- Dos clientas del mismo gimnasio. A Ana la atiende Camilo; a Bruno no lo
-- atiende nadie, que es lo que separa lo que ve un owner de lo que ve un coach.
insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000101', 'active'),
  ('019c3000-0000-7000-8000-000000000402', '019c3000-0000-7000-8000-000000000002',
    '019c3000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values (
  '019c3000-0000-7000-8000-000000000501', '019c3000-0000-7000-8000-000000000401',
  '019c3000-0000-7000-8000-000000000001', '019c3000-0000-7000-8000-000000000101',
  '019c3000-0000-7000-8000-000000000202', 'holder', 'active'
);

-- La cadena que un grant exige: invitación, intención, opción y decisión.
insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values
  ('019c3000-0000-7000-8000-000000000801', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000201', 'email', 'ana@example.test',
    extensions.digest('scopes-ana', 'sha256'), 1,
    extensions.digest('scopes-ana-proposal', 'sha256'),
    '{"party_kind":"legal_entity","party_name":"Scopes SAS","purpose":"studio_operations"}',
    'completed', clock_timestamp() + interval '7 days'),
  ('019c3000-0000-7000-8000-000000000802', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000201', 'email', 'bruno@example.test',
    extensions.digest('scopes-bruno', 'sha256'), 1,
    extensions.digest('scopes-bruno-proposal', 'sha256'),
    '{"party_kind":"legal_entity","party_name":"Scopes SAS","purpose":"studio_operations"}',
    'completed', clock_timestamp() + interval '7 days');

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values
  ('019c3000-0000-7000-8000-000000000901', '019c3000-0000-7000-8000-000000000801',
    'service_relationship', 'pending', null),
  ('019c3000-0000-7000-8000-000000000902', '019c3000-0000-7000-8000-000000000802',
    'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values
  ('019c3000-0000-7000-8000-000000000a01', '019c3000-0000-7000-8000-000000000901',
    '019c3000-0000-7000-8000-000000000301', 'health_context', 'read',
    'Adaptar el entrenamiento', '{"title":"Contexto de salud"}'::jsonb,
    'accepted', clock_timestamp()),
  ('019c3000-0000-7000-8000-000000000a02', '019c3000-0000-7000-8000-000000000901',
    '019c3000-0000-7000-8000-000000000302', 'body_progress', 'read',
    'Seguir el progreso', '{"title":"Progreso corporal"}'::jsonb,
    'accepted', clock_timestamp()),
  ('019c3000-0000-7000-8000-000000000a03', '019c3000-0000-7000-8000-000000000902',
    '019c3000-0000-7000-8000-000000000301', 'health_context', 'read',
    'Adaptar el entrenamiento', '{"title":"Contexto de salud"}'::jsonb,
    'accepted', clock_timestamp());

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot
) values
  ('019c3000-0000-7000-8000-000000000b01', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000a01', '019c3000-0000-7000-8000-000000000301',
    'health_context', 'accepted', '{"title":"Contexto de salud"}'::jsonb),
  ('019c3000-0000-7000-8000-000000000b02', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000a02', '019c3000-0000-7000-8000-000000000302',
    'body_progress', 'accepted', '{"title":"Progreso corporal"}'::jsonb),
  ('019c3000-0000-7000-8000-000000000b03', '019c3000-0000-7000-8000-000000000002',
    '019c3000-0000-7000-8000-000000000402', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000a03', '019c3000-0000-7000-8000-000000000301',
    'health_context', 'accepted', '{"title":"Contexto de salud"}'::jsonb);

-- Ana autorizó dos categorías y retiró una: el criterio 4 pide que lo retirado
-- se siga viendo aquí, con su fecha, porque es lo que explica haber dejado de
-- ver esa parte.
insert into privacy.data_grants (
  id, person_id, relationship_id, organization_id, scope_definition_id, scope_code,
  consent_event_id, access_level, purpose, status, granted_at, revoked_at
) values
  ('019c3000-0000-7000-8000-000000000c01', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000301', 'health_context',
    '019c3000-0000-7000-8000-000000000b01', 'read', 'Adaptar el entrenamiento',
    'active', '2026-10-01T12:00:00Z', null),
  ('019c3000-0000-7000-8000-000000000c02', '019c3000-0000-7000-8000-000000000001',
    '019c3000-0000-7000-8000-000000000401', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000302', 'body_progress',
    '019c3000-0000-7000-8000-000000000b02', 'read', 'Seguir el progreso',
    'revoked', '2026-10-02T12:00:00Z', '2026-10-20T12:00:00Z'),
  ('019c3000-0000-7000-8000-000000000c03', '019c3000-0000-7000-8000-000000000002',
    '019c3000-0000-7000-8000-000000000402', '019c3000-0000-7000-8000-000000000101',
    '019c3000-0000-7000-8000-000000000301', 'health_context',
    '019c3000-0000-7000-8000-000000000b03', 'read', 'Adaptar el entrenamiento',
    'active', '2026-10-03T12:00:00Z', null);

-- Sin esto el test corre como superusuario y ninguna política se aplica: la
-- aserción del coach pasaría sola, que es la forma más silenciosa de no probar
-- nada.
set local role allfit_owner;

-- ---------------------------------------------------------------------------
-- Un owner ve a todo el mundo
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select is(
  (select count(*)::int
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000011',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null)),
  3,
  'un owner ve las tres autorizaciones de las dos clientas'
);

select is(
  (select count(distinct entry.person_id)::int
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000011',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null) as entry),
  2,
  'y las ve repartidas entre las dos personas'
);

-- Criterio 4: lo retirado se sigue viendo, con su fecha.
select is(
  (select entry.revoked_at
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000011',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null) as entry
   where entry.grant_id = '019c3000-0000-7000-8000-000000000c02'),
  '2026-10-20T12:00:00Z'::timestamptz,
  'un permiso retirado sigue en el registro, con la fecha en que se retiró'
);

select is(
  (select entry.status
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000011',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null) as entry
   where entry.grant_id = '019c3000-0000-7000-8000-000000000c02'),
  'revoked',
  'y dice que está retirado'
);

-- Criterio 1: desde cuándo.
select is(
  (select entry.granted_at
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000011',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null) as entry
   where entry.grant_id = '019c3000-0000-7000-8000-000000000c01'),
  '2026-10-01T12:00:00Z'::timestamptz,
  'cada autorización dice desde cuándo rige'
);

-- Criterio 3, fijado y no leído: el día que alguien añada una columna con
-- contenido de la persona, este test se cae.
select set_eq(
  $$select parameter.parameter_name::text
    from information_schema.routines as routine
    join information_schema.parameters as parameter
      on parameter.specific_name = routine.specific_name
    where routine.routine_schema = 'privacy'
      and routine.routine_name = 'list_authorized_scopes'
      and parameter.parameter_mode = 'OUT'$$,
  $$select unnest(array[
      'relationship_id', 'person_id', 'display_name', 'grant_id', 'scope_code',
      'scope_display_name', 'version_number', 'access_level', 'status',
      'purpose', 'granted_at', 'revoked_at', 'sort_name', 'sort_id'
    ])$$,
  'el registro dice el estado del permiso y ni un dato de lo que ampara'
);

-- ---------------------------------------------------------------------------
-- Un coach ve solo a quien atiende — criterio 2
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000012', true);

select is(
  (select count(*)::int
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000012',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null)),
  2,
  'un coach ve las dos autorizaciones de la clienta que atiende'
);

-- La aserción de negación. La política del permiso estrecha a la organización,
-- así que una función que leyera `data_grants` sola devolvería aquí una fila.
select is(
  (select count(*)::int
   from privacy.list_authorized_scopes(
     '019c3000-0000-7000-8000-000000000012',
     '019c3000-0000-7000-8000-000000000101',
     50, null, null) as entry
   where entry.person_id = '019c3000-0000-7000-8000-000000000002'),
  0,
  'y no ve nada de la clienta que no atiende'
);

-- ---------------------------------------------------------------------------
-- Quien no pertenece no entra
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000015', true);

select throws_ok(
  $$select * from privacy.list_authorized_scopes(
      '019c3000-0000-7000-8000-000000000015',
      '019c3000-0000-7000-8000-000000000101',
      50, null, null)$$,
  '42501',
  null,
  'alguien de otro gimnasio es rechazado'
);

select set_config('app.actor_person_id', '019c3000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$select * from privacy.list_authorized_scopes(
      '019c3000-0000-7000-8000-000000000012',
      '019c3000-0000-7000-8000-000000000101',
      50, null, null)$$,
  '42501',
  null,
  'nadie consulta en nombre de otra persona'
);

-- ---------------------------------------------------------------------------
-- La página se pide bien o no se pide
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select * from privacy.list_authorized_scopes(
      '019c3000-0000-7000-8000-000000000011',
      '019c3000-0000-7000-8000-000000000101',
      0, null, null)$$,
  '22023',
  null,
  'un tamaño de página fuera de rango se rechaza'
);

select throws_ok(
  $$select * from privacy.list_authorized_scopes(
      '019c3000-0000-7000-8000-000000000011',
      '019c3000-0000-7000-8000-000000000101',
      50, 'Ana Asignada', null)$$,
  '22023',
  null,
  'medio cursor no es un cursor'
);

select * from finish();
rollback;
