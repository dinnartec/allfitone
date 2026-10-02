-- T-REL-STATE-01 — OP-REL-011.
--
-- Qué puede decir una relación sobre sí misma, y qué no.
--
-- La aserción que más pesa es la del conjunto exacto de claves de un permiso.
-- El criterio 3 dice que saber que existe un permiso de contexto de salud no es
-- leer el contexto de salud, y eso no se comprueba leyendo lo que el documento
-- trae: se comprueba fijando lo que trae, para que el día que alguien añada un
-- campo con contenido, este test se caiga.
--
-- La segunda que pesa: un coach no asignado recibe «no existe», no «no puedes».
-- Decirle que la relación existe pero no es suya ya le cuenta que el gimnasio
-- tiene a esa persona como clienta.

begin;

select plan(15);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c2000-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active'),
  ('019c2000-0000-7000-8000-000000000002', 'Bruno', 'Cliente', 'active'),
  ('019c2000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019c2000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019c2000-0000-7000-8000-000000000013', 'Diana', 'Coach', 'active'),
  ('019c2000-0000-7000-8000-000000000014', 'Sara', 'Staff', 'active'),
  ('019c2000-0000-7000-8000-000000000015', 'Elena', 'Ajena', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c2000-0000-7000-8000-000000000101', 'gym', 'State Gym',
    '{"party_kind":"legal_entity","party_name":"State SAS","purpose":"studio_operations"}'),
  ('019c2000-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c2000-0000-7000-8000-000000000201', '019c2000-0000-7000-8000-000000000101',
    '019c2000-0000-7000-8000-000000000011', 'active'),
  ('019c2000-0000-7000-8000-000000000202', '019c2000-0000-7000-8000-000000000101',
    '019c2000-0000-7000-8000-000000000012', 'active'),
  ('019c2000-0000-7000-8000-000000000203', '019c2000-0000-7000-8000-000000000101',
    '019c2000-0000-7000-8000-000000000013', 'active'),
  ('019c2000-0000-7000-8000-000000000204', '019c2000-0000-7000-8000-000000000101',
    '019c2000-0000-7000-8000-000000000014', 'active'),
  ('019c2000-0000-7000-8000-000000000205', '019c2000-0000-7000-8000-000000000102',
    '019c2000-0000-7000-8000-000000000015', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c2000-0000-7000-8000-000000000201', 'owner'),
  ('019c2000-0000-7000-8000-000000000202', 'coach'),
  ('019c2000-0000-7000-8000-000000000203', 'coach'),
  ('019c2000-0000-7000-8000-000000000204', 'staff'),
  ('019c2000-0000-7000-8000-000000000205', 'owner');

-- Versión 2 a propósito: el criterio 2 pide la versión en que se concedió, y
-- una versión 1 pasaría igual si la función devolviera un literal.
insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019c2000-0000-7000-8000-000000000301', 'health_context', 2, 'published', clock_timestamp());

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000001',
    '019c2000-0000-7000-8000-000000000101', 'active'),
  -- Bruno no tiene responsable: el caso que la pantalla de AFO-128 necesita
  -- distinguir antes de asignar.
  ('019c2000-0000-7000-8000-000000000702', '019c2000-0000-7000-8000-000000000002',
    '019c2000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values (
  '019c2000-0000-7000-8000-000000000801', '019c2000-0000-7000-8000-000000000701',
  '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000202', 'holder', 'active'
);

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status, ends_on
) values (
  '019c2000-0000-7000-8000-000000000802', '019c2000-0000-7000-8000-000000000701',
  '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000203', 'substitute', 'proposed',
  (clock_timestamp() + interval '10 days')::date
);

-- La cadena que un grant exige: invitación, intención, opción y decisión.
insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values (
  '019c2000-0000-7000-8000-000000000401', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000201', 'email', 'ana@example.test',
  extensions.digest('state-token', 'sha256'), 1,
  extensions.digest('state-proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"State SAS","purpose":"studio_operations"}',
  'completed', clock_timestamp() + interval '7 days'
);

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values ('019c2000-0000-7000-8000-000000000501', '019c2000-0000-7000-8000-000000000401',
  'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values (
  '019c2000-0000-7000-8000-000000000601', '019c2000-0000-7000-8000-000000000501',
  '019c2000-0000-7000-8000-000000000301', 'health_context', 'read',
  'Adaptar el entrenamiento', '{"title":"Contexto de salud"}'::jsonb,
  'accepted', clock_timestamp()
);

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot
) values (
  '019c2000-0000-7000-8000-000000000901', '019c2000-0000-7000-8000-000000000001',
  '019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000601', '019c2000-0000-7000-8000-000000000301',
  'health_context', 'accepted', '{"title":"Contexto de salud"}'::jsonb
);

insert into privacy.data_grants (
  id, person_id, relationship_id, organization_id, scope_definition_id, scope_code,
  consent_event_id, access_level, purpose
) values (
  '019c2000-0000-7000-8000-000000000a01', '019c2000-0000-7000-8000-000000000001',
  '019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000301', 'health_context',
  '019c2000-0000-7000-8000-000000000901', 'read', 'Adaptar el entrenamiento'
);

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') ->> 'status'),
  'active',
  'un owner lee el estado del vínculo'
);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'holder' ->> 'display_name'),
  'Camilo Coach',
  'y quién es el profesional responsable, con nombre'
);

/*
 * Nombre y persona del responsable, por separado. Sin esta aserción el
 * documento devolvía la persona atendida bajo el nombre del profesional: en la
 * tabla, `person_id` es la clienta, y comprobar solo el nombre no lo revela.
 */
select is(
  (select (relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'holder' ->> 'professional_person_id')::uuid),
  '019c2000-0000-7000-8000-000000000012'::uuid,
  'el responsable es Camilo, no la persona a la que atiende'
);

select is(
  (select jsonb_array_length(relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'substitutions')),
  1,
  'y las suplencias de la relación'
);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'substitutions' -> 0 ->> 'status'),
  'proposed',
  'una suplencia propuesta se ve como propuesta, no como vigente'
);

-- Criterio 2: qué se concedió y en qué versión.
select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'grants' -> 0 ->> 'scope_code'),
  'health_context',
  'el documento dice qué permiso está concedido'
);

select is(
  (select (relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'grants' -> 0 ->> 'version_number')::int),
  2,
  'y en qué versión se concedió, no en la última publicada'
);

select isnt(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'grants' -> 0 ->> 'display_name'),
  null,
  'con las mismas palabras que la persona vio al decidir'
);

/*
 * Criterio 3, la aserción que más pesa. Fija el conjunto exacto de campos de un
 * permiso: todos hablan del permiso, ninguno del dato que ampara. Si alguien
 * añade un campo con contenido, esto se cae antes de llegar a producción.
 */
select is(
  (select jsonb_agg(key order by key)
   from jsonb_object_keys(relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'grants' -> 0) as key),
  '["access_level","display_name","grant_id","granted_at","purpose","revoked_at","scope_code","status","version_number"]'::jsonb,
  'saber que hay un permiso de salud no trae ni un dato de salud'
);

-- El caso que AFO-128 necesita distinguir: nadie la atiende todavía.
select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000702') -> 'holder'),
  'null'::jsonb,
  'una relación sin responsable lo dice con null, no omitiendo el campo'
);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000011', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000702') -> 'substitutions'),
  '[]'::jsonb,
  'y sin suplencias devuelve lista vacía, no null'
);

-- A6: staff tiene `view_directory`.
select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000014', true);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000014', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') ->> 'display_name'),
  'Ana Cliente',
  'staff de la organización también puede consultar una relación'
);

-- A3: el coach responsable sí la ve.
select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000012', true);

select is(
  (select relationships.read_relationship_state(
     '019c2000-0000-7000-8000-000000000012', '019c2000-0000-7000-8000-000000000101',
     '019c2000-0000-7000-8000-000000000701') -> 'holder' ->> 'membership_id'),
  '019c2000-0000-7000-8000-000000000202',
  'el coach responsable se ve a sí mismo como responsable'
);

/*
 * A3 sin asignación. «No existe» y no «no puedes»: la diferencia entre los dos
 * mensajes es contarle que el gimnasio tiene a esa persona como clienta.
 */
select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000013', true);

select throws_ok(
  $$select relationships.read_relationship_state(
      '019c2000-0000-7000-8000-000000000013', '019c2000-0000-7000-8000-000000000101',
      '019c2000-0000-7000-8000-000000000701')$$,
  'P0002',
  'relationship not found',
  'un coach sin asignación efectiva no la encuentra'
);

-- Otra organización: ni siquiera llega a la relación.
select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000015', true);

select throws_ok(
  $$select relationships.read_relationship_state(
      '019c2000-0000-7000-8000-000000000015', '019c2000-0000-7000-8000-000000000101',
      '019c2000-0000-7000-8000-000000000701')$$,
  '42501',
  'reading a relationship requires a directory capability',
  'el owner de otro gimnasio no tiene nada que consultar aquí'
);

select * from finish();

rollback;
