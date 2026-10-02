-- T-REL-ASSIGN-01 — OP-REL-002.
--
-- Asignar un responsable es decir quién atiende, y nada más. La aserción que
-- más pesa es la tercera: después de asignar, la persona no tiene ni un grant
-- más que antes. Un profesional responsable sin permiso de la persona no ve
-- absolutamente nada, y ese es el criterio 4.
--
-- Las otras tres reglas del caso ya viven en la forma de la tabla —clave
-- foránea compuesta para la organización, índice único para el titular— así
-- que aquí se comprueba que siguen mordiendo, no se reimplementan.
--
-- Y una denegación que no es un criterio de la historia sino un límite entre
-- historias: quitarle el cliente a un coach para dárselo a otro es OP-REL-003,
-- que debe avisar a la persona. Esta función se niega a hacerlo callada.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c1000-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active'),
  ('019c1000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019c1000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019c1000-0000-7000-8000-000000000013', 'Sara', 'Staff', 'active'),
  ('019c1000-0000-7000-8000-000000000014', 'Diana', 'Coach', 'active'),
  ('019c1000-0000-7000-8000-000000000015', 'Elena', 'Ajena', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c1000-0000-7000-8000-000000000101', 'gym', 'Assign Gym',
    '{"party_kind":"legal_entity","party_name":"Assign SAS","purpose":"studio_operations"}'),
  ('019c1000-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c1000-0000-7000-8000-000000000201', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000011', 'active'),
  ('019c1000-0000-7000-8000-000000000202', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000012', 'active'),
  ('019c1000-0000-7000-8000-000000000203', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000013', 'active'),
  ('019c1000-0000-7000-8000-000000000204', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000014', 'active'),
  -- Elena es coach, pero del otro gimnasio.
  ('019c1000-0000-7000-8000-000000000205', '019c1000-0000-7000-8000-000000000102',
    '019c1000-0000-7000-8000-000000000015', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c1000-0000-7000-8000-000000000201', 'owner'),
  ('019c1000-0000-7000-8000-000000000202', 'coach'),
  ('019c1000-0000-7000-8000-000000000203', 'staff'),
  ('019c1000-0000-7000-8000-000000000204', 'coach'),
  ('019c1000-0000-7000-8000-000000000205', 'coach');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000001',
    '019c1000-0000-7000-8000-000000000101', 'active'),
  ('019c1000-0000-7000-8000-000000000302', '019c1000-0000-7000-8000-000000000001',
    '019c1000-0000-7000-8000-000000000101', 'terminated');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- El owner asigna a Camilo, que es coach de esta organización.
select is(
  (select created from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000202',
    '019c1000-0000-7000-8000-000000000f01', '019c1000-0000-7000-8000-000000000f01',
    extensions.digest('assign-1', 'sha256'))),
  true,
  'un owner asigna el profesional responsable de una relación'
);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c1000-0000-7000-8000-000000000301'
     and kind = 'holder' and status = 'active'),
  1,
  'y queda exactamente un titular activo'
);

-- Criterio 4, el que más pesa. Asignar dice quién atiende, nunca qué puede ver.
select is(
  (select count(*)::int from privacy.data_grants
   where person_id = '019c1000-0000-7000-8000-000000000001'),
  0,
  'asignar no concede ni un permiso sobre los datos de la persona'
);

-- Asignar a quien ya atiende no es un error, pero tampoco escribe nada: la
-- fecha desde la que atiende a esta persona es un dato, no un contador.
select is(
  (select created from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000202',
    '019c1000-0000-7000-8000-000000000f02', '019c1000-0000-7000-8000-000000000f02',
    extensions.digest('assign-2', 'sha256'))),
  false,
  'asignar a quien ya es titular no crea otra asignación'
);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c1000-0000-7000-8000-000000000301'),
  1,
  'ni deja una segunda fila en la historia'
);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c1000-0000-7000-8000-000000000301'
     and status = 'ended'),
  0,
  'ni cierra la que ya estaba vigente'
);

-- El límite entre HU-STUDIO-027 y HU-STUDIO-028. Cambiar de titular avisa a la
-- persona dentro de la misma transacción; esta operación no avisa a nadie, así
-- que no puede ser la que cambie el titular.
select throws_ok(
  $$select * from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000204',
    '019c1000-0000-7000-8000-000000000f03', '019c1000-0000-7000-8000-000000000f03',
    extensions.digest('assign-3', 'sha256'))$$,
  'P0004',
  'this relationship already has a holder; changing it is a separate operation',
  'reemplazar al titular no se hace por aquí'
);

select is(
  (select membership_id from relationships.relationship_professional_assignments
   where relationship_id = '019c1000-0000-7000-8000-000000000301'
     and kind = 'holder' and status = 'active'),
  '019c1000-0000-7000-8000-000000000202'::uuid,
  'y el titular de antes sigue siendo el titular'
);

-- Reintentar el mismo comando devuelve la misma asignación.
select is(
  (select replayed from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000202',
    '019c1000-0000-7000-8000-000000000f01', '019c1000-0000-7000-8000-000000000f01',
    extensions.digest('assign-1', 'sha256'))),
  true,
  'repetir el comando lo reproduce en vez de asignar dos veces'
);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c1000-0000-7000-8000-000000000301'),
  1,
  'y el reintento tampoco añade una fila'
);

-- Criterio 1: staff no es coach.
select throws_ok(
  $$select * from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000203',
    '019c1000-0000-7000-8000-000000000f04', '019c1000-0000-7000-8000-000000000f04',
    extensions.digest('assign-4', 'sha256'))$$,
  '42501',
  'a holder must be an active coach of this organization',
  'alguien sin rol de coach no puede ser responsable'
);

-- Criterio 2: Elena es coach, pero de otro gimnasio.
select throws_ok(
  $$select * from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000205',
    '019c1000-0000-7000-8000-000000000f05', '019c1000-0000-7000-8000-000000000f05',
    extensions.digest('assign-5', 'sha256'))$$,
  '42501',
  'a holder must be an active coach of this organization',
  'un coach de otra organización nunca puede asignarse'
);

-- Una relación terminada no tiene a quién atender.
select throws_ok(
  $$select * from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000011', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000302', '019c1000-0000-7000-8000-000000000202',
    '019c1000-0000-7000-8000-000000000f06', '019c1000-0000-7000-8000-000000000f06',
    extensions.digest('assign-6', 'sha256'))$$,
  'P0004',
  'only an active relationship takes a holder',
  'una relación terminada no admite un responsable nuevo'
);

-- Un coach no asigna: la capacidad es de owner y admin.
select set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000012', true);

select throws_ok(
  $$select * from relationships.assign_relationship_holder(
    '019c1000-0000-7000-8000-000000000012', '019c1000-0000-7000-8000-000000000101',
    '019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000202',
    '019c1000-0000-7000-8000-000000000f07', '019c1000-0000-7000-8000-000000000f07',
    extensions.digest('assign-7', 'sha256'))$$,
  '42501',
  'assigning a professional requires assign_professionals',
  'un coach no reparte responsables, ni siquiera a sí mismo'
);

select * from finish();

rollback;
