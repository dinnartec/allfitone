-- T-REL-SUBSTITUTION-LIST-01 — OP-REL-013.
--
-- Listar las suplencias de un vínculo, las vigentes y las pasadas.
--
-- La aserción que pesa es la del criterio 2: **leer una suplencia terminada no
-- le devuelve el acceso a nadie**. Es lo contrario de lo que haría una lista
-- escrita a la ligera, que al sacar la fila podría dar por reabierto lo que
-- describe. Aquí se comprueba que la suplente de una suplencia que aparece en
-- la lista sigue sin poder leer la relación.
--
-- La segunda es el orden. La ficha del cliente las ordena de la más vieja a la
-- más nueva, así que la que está corriendo queda debajo de todas las que ya
-- terminaron — invisible con dos, un muro a los dos años. Esta las devuelve al
-- revés, y hay una aserción que lo fija.
--
-- Y la tercera es la persona. `OP-REL-011` es solo de Studio, así que hoy la
-- persona no tiene forma de ver quién ha tenido acceso a sus datos. Aquí sí, y
-- sin pedirle que pertenezca a ninguna organización.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c9200-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active', 'ana@example.test'),
  ('019c9200-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active', null),
  ('019c9200-0000-7000-8000-000000000012', 'Camilo', 'Titular', 'active', null),
  ('019c9200-0000-7000-8000-000000000013', 'Elena', 'Suplente', 'active', null),
  ('019c9200-0000-7000-8000-000000000014', 'Rita', 'Suplente', 'active', null),
  ('019c9200-0000-7000-8000-000000000015', 'Tomás', 'Ajeno', 'active', null);

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c9200-0000-7000-8000-000000000101', 'gym', 'List Gym',
    '{"party_kind":"legal_entity","party_name":"List SAS","purpose":"studio_operations"}'),
  ('019c9200-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c9200-0000-7000-8000-000000000201', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000011', 'active'),
  ('019c9200-0000-7000-8000-000000000202', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000012', 'active'),
  ('019c9200-0000-7000-8000-000000000203', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000013', 'active'),
  ('019c9200-0000-7000-8000-000000000204', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000014', 'active'),
  ('019c9200-0000-7000-8000-000000000205', '019c9200-0000-7000-8000-000000000102',
    '019c9200-0000-7000-8000-000000000015', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c9200-0000-7000-8000-000000000201', 'owner'),
  ('019c9200-0000-7000-8000-000000000202', 'coach'),
  ('019c9200-0000-7000-8000-000000000203', 'coach'),
  ('019c9200-0000-7000-8000-000000000204', 'coach'),
  ('019c9200-0000-7000-8000-000000000205', 'owner');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c9200-0000-7000-8000-000000000701', '019c9200-0000-7000-8000-000000000001',
    '019c9200-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status,
  covers_membership_id, valid_from, valid_to, ends_on, accepted_by_person_at
) values
  ('019c9200-0000-7000-8000-000000000801', '019c9200-0000-7000-8000-000000000701',
    '019c9200-0000-7000-8000-000000000001', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000202', 'holder', 'active',
    null, clock_timestamp() - interval '400 days', null, null, null),
  -- La vieja: terminada hace tiempo. Es la que la ficha pone primero hoy.
  ('019c9200-0000-7000-8000-000000000802', '019c9200-0000-7000-8000-000000000701',
    '019c9200-0000-7000-8000-000000000001', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000203', 'substitute', 'ended',
    '019c9200-0000-7000-8000-000000000202',
    clock_timestamp() - interval '300 days', clock_timestamp() - interval '290 days',
    (current_date - 290), clock_timestamp() - interval '301 days'),
  -- La que está corriendo ahora.
  ('019c9200-0000-7000-8000-000000000803', '019c9200-0000-7000-8000-000000000701',
    '019c9200-0000-7000-8000-000000000001', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000204', 'substitute', 'active',
    '019c9200-0000-7000-8000-000000000202',
    clock_timestamp() - interval '1 day', null, (current_date + 10),
    clock_timestamp() - interval '2 days');

set local role allfit_owner;

-- ———————————————————————————————————— El owner las ve todas, lo nuevo primero

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019c9200-0000-7000-8000-000000000101', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select is(
  (select count(*)::int from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
     '019c9200-0000-7000-8000-000000000701', 50, null, null)),
  2,
  'un owner ve las dos: la vigente y la que ya terminó'
);

/*
 * El orden, que es la mitad del valor de esta operación. La ficha del cliente
 * las ordena ascendente, así que la que corre queda enterrada bajo las viejas.
 */
select is(
  (select string_agg(display_name, ',' order by valid_from desc)
   from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
     '019c9200-0000-7000-8000-000000000701', 50, null, null)),
  'Rita Suplente,Elena Suplente',
  'la que está corriendo sale primero, no sepultada bajo las terminadas'
);

select is(
  (select status from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
     '019c9200-0000-7000-8000-000000000701', 1, null, null)),
  'active',
  'y es la primera de la página'
);

-- ———————————————————————————————————— Criterio 2

/*
 * Lo que de verdad hay que demostrar. La suplencia de Elena aparece en la lista
 * y eso no le devuelve nada: terminó, y la fórmula que consulta toda política
 * de privacidad lo sabe. Leer un hecho del pasado no es reabrirlo.
 */
select set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000013', true);

select ok(
  not relationships.actor_is_assigned('019c9200-0000-7000-8000-000000000701'),
  'la suplente de una suplencia terminada sigue sin leer la relación'
);

select set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000014', true);

select ok(
  relationships.actor_is_assigned('019c9200-0000-7000-8000-000000000701'),
  'y la que sí está cubriendo ahora, sí'
);

-- ———————————————————————————————————— La persona, desde Space

/*
 * Sin organización en los argumentos y sin pertenecer a ninguna. Hoy no tiene
 * ninguna otra forma de saber quién ha tenido acceso a sus datos.
 */
select set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000001', true),
       set_config('app.actor_org_id', '', true);

select is(
  (select count(*)::int from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000001', null,
     '019c9200-0000-7000-8000-000000000701', 50, null, null)),
  2,
  'la persona ve quién ha estado autorizado sobre sus datos'
);

select is(
  (select display_name from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000001', null,
     '019c9200-0000-7000-8000-000000000701', 1, null, null)),
  'Rita Suplente',
  'con el mismo orden: lo vigente primero'
);

-- ———————————————————————————————————— Quién no

select set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000015', true),
       set_config('app.actor_org_id', '019c9200-0000-7000-8000-000000000102', true);

select throws_ok(
  $$select * from relationships.list_relationship_substitutions(
    '019c9200-0000-7000-8000-000000000015', '019c9200-0000-7000-8000-000000000102',
    '019c9200-0000-7000-8000-000000000701', 50, null, null)$$,
  'P0002', null,
  'el owner de otra organización no encuentra la relación'
);

-- Nombrar la organización ajena de otro no abre la puerta: la relación se busca
-- con las dos condiciones a la vez.
select throws_ok(
  $$select * from relationships.list_relationship_substitutions(
    '019c9200-0000-7000-8000-000000000015', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000701', 50, null, null)$$,
  'P0002', null,
  'ni nombrando la organización correcta sin pertenecer a ella'
);

-- ———————————————————————————————————— Paginación

select set_config('app.actor_person_id', '019c9200-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019c9200-0000-7000-8000-000000000101', true);

select is(
  (select display_name from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
     '019c9200-0000-7000-8000-000000000701', 50,
     (select valid_from from relationships.relationship_professional_assignments
      where id = '019c9200-0000-7000-8000-000000000803'),
     '019c9200-0000-7000-8000-000000000803')),
  'Elena Suplente',
  'el cursor sigue por donde iba, sin repetir la primera'
);

-- Media cursor is a caller who built it by hand. Servirle la página uno en
-- silencio se lee como suplencias duplicadas, no como un fallo.
select throws_ok(
  $$select * from relationships.list_relationship_substitutions(
    '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000701', 50, clock_timestamp(), null)$$,
  '22023', null,
  'medio cursor se rechaza en vez de servir la primera página'
);

select throws_ok(
  $$select * from relationships.list_relationship_substitutions(
    '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000701', 0, null, null)$$,
  '22023', null,
  'una página de cero no es una página'
);

select throws_ok(
  $$select * from relationships.list_relationship_substitutions(
    '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
    '019c9200-0000-7000-8000-000000000701', 500, null, null)$$,
  '22023', null,
  'ni una de quinientas'
);

-- ———————————————————————————————————— Nada que listar

select is(
  (select count(*)::int from relationships.list_relationship_substitutions(
     '019c9200-0000-7000-8000-000000000011', '019c9200-0000-7000-8000-000000000101',
     '019c9200-0000-7000-8000-000000000701', 50,
     (select valid_from from relationships.relationship_professional_assignments
      where id = '019c9200-0000-7000-8000-000000000802'),
     '019c9200-0000-7000-8000-000000000802')),
  0,
  'pasada la última, la página viene vacía y no da la vuelta'
);

select * from finish();
rollback;
