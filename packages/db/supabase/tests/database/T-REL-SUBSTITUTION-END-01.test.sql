-- T-REL-SUBSTITUTION-END-01 — OP-REL-006.
--
-- Terminar una suplencia antes de su fecha.
--
-- La aserción que sostiene todo es la del acceso: en cuanto la fila se cierra,
-- `actor_is_assigned` deja de reconocer a la suplente. El criterio 1 dice «de
-- inmediato», y aquí eso no es una promesa del código sino una consecuencia de
-- la columna `valid_to`, que la fórmula ya mira. No hay proceso que apagar.
--
-- Las dos siguientes son el criterio 2: el titular y la relación no se tocan.
-- Terminar una suplencia devuelve la atención a quien ya la tenía; no es una
-- reasignación encubierta.
--
-- Después está quién puede. El catálogo da `A2`, `A4` y `A5`: la persona, el
-- admin y el owner. **No el titular**, que sí puede proponerla — la asimetría
-- es deliberada y hay una aserción dedicada, porque es lo primero que alguien
-- «arreglaría» sin querer.
--
-- Y una que viene de un defecto real: un `update` que no encuentra filas no
-- falla, devuelve éxito sin escribir. Por eso se comprueba el estado leído de
-- la tabla y no lo que la función dice haber hecho.

begin;

select plan(18);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c9100-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active', 'ana@example.test'),
  ('019c9100-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active', null),
  ('019c9100-0000-7000-8000-000000000012', 'Camilo', 'Titular', 'active', null),
  ('019c9100-0000-7000-8000-000000000013', 'Elena', 'Suplente', 'active', null),
  ('019c9100-0000-7000-8000-000000000014', 'Sara', 'Staff', 'active', null),
  ('019c9100-0000-7000-8000-000000000015', 'Rita', 'Propuesta', 'active', null),
  ('019c9100-0000-7000-8000-000000000016', 'Tomás', 'Ajeno', 'active', null);

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c9100-0000-7000-8000-000000000101', 'gym', 'End Gym',
    '{"party_kind":"legal_entity","party_name":"End SAS","purpose":"studio_operations"}'),
  ('019c9100-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c9100-0000-7000-8000-000000000201', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000011', 'active'),
  ('019c9100-0000-7000-8000-000000000202', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000012', 'active'),
  ('019c9100-0000-7000-8000-000000000203', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000013', 'active'),
  ('019c9100-0000-7000-8000-000000000204', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000014', 'active'),
  ('019c9100-0000-7000-8000-000000000205', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000015', 'active'),
  -- Owner de otra organización: el control de inquilino.
  ('019c9100-0000-7000-8000-000000000206', '019c9100-0000-7000-8000-000000000102',
    '019c9100-0000-7000-8000-000000000016', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c9100-0000-7000-8000-000000000201', 'owner'),
  ('019c9100-0000-7000-8000-000000000202', 'coach'),
  ('019c9100-0000-7000-8000-000000000203', 'coach'),
  ('019c9100-0000-7000-8000-000000000204', 'staff'),
  ('019c9100-0000-7000-8000-000000000205', 'coach'),
  ('019c9100-0000-7000-8000-000000000206', 'owner');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000001',
    '019c9100-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status,
  covers_membership_id, ends_on, accepted_by_person_at
) values
  ('019c9100-0000-7000-8000-000000000801', '019c9100-0000-7000-8000-000000000701',
    '019c9100-0000-7000-8000-000000000001', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000202', 'holder', 'active', null, null, null),
  -- Elena cubre a Camilo y la persona ya dijo que sí: es la única que lee algo.
  ('019c9100-0000-7000-8000-000000000802', '019c9100-0000-7000-8000-000000000701',
    '019c9100-0000-7000-8000-000000000001', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000203', 'substitute', 'active',
    '019c9100-0000-7000-8000-000000000202', current_date + 10, clock_timestamp()),
  -- Rita está propuesta y nadie ha contestado: no hay acceso que cortar.
  ('019c9100-0000-7000-8000-000000000803', '019c9100-0000-7000-8000-000000000701',
    '019c9100-0000-7000-8000-000000000001', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000205', 'substitute', 'proposed',
    '019c9100-0000-7000-8000-000000000202', current_date + 10, null);

set local role allfit_owner;

-- ———————————————————————————————————— Antes de terminar

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000013', true),
       set_config('app.actor_org_id', '019c9100-0000-7000-8000-000000000101', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select ok(
  relationships.actor_is_assigned('019c9100-0000-7000-8000-000000000701'),
  'la suplente aceptada lee la relación mientras la suplencia corre'
);

-- ———————————————————————————————————— Quién no puede

-- El titular. Puede proponer una suplencia y no puede terminarla: `OP-REL-004`
-- lo acepta y `OP-REL-006` no. Si alguien «corrige» esta asimetría, falla aquí.
select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000012', true);

select throws_ok(
  $$select relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000012', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f01', '019c9100-0000-7000-8000-000000000f01',
    extensions.digest('end-holder', 'sha256'))$$,
  '42501', null,
  'el titular no puede terminar la suplencia que él mismo pidió'
);

select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000014', true);

select throws_ok(
  $$select relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000014', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f02', '019c9100-0000-7000-8000-000000000f02',
    extensions.digest('end-staff', 'sha256'))$$,
  '42501', null,
  'el staff tampoco: gestiona directorio, no quién atiende'
);

-- Otro inquilino. Responde «no existe», no «no puedes»: quién es cliente de
-- quién no se le confirma a una organización ajena.
select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000016', true),
       set_config('app.actor_org_id', '019c9100-0000-7000-8000-000000000102', true);

select throws_ok(
  $$select relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000016', '019c9100-0000-7000-8000-000000000102',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f03', '019c9100-0000-7000-8000-000000000f03',
    extensions.digest('end-tenant', 'sha256'))$$,
  'P0002', null,
  'el owner de otra organización no encuentra la relación'
);

-- ———————————————————————————————————— Una propuesta no se termina

select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019c9100-0000-7000-8000-000000000101', true);

select throws_ok(
  $$select relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000011', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000803',
    '019c9100-0000-7000-8000-000000000f04', '019c9100-0000-7000-8000-000000000f04',
    extensions.digest('end-proposed', 'sha256'))$$,
  'P0004', null,
  'una suplencia que nadie ha respondido no se termina: se retira (STUDIO-150)'
);

select is(
  (select status::text from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000803'),
  'proposed',
  'y la propuesta sigue en pie, sin tocar'
);

-- ———————————————————————————————————— El owner la termina

select is(
  (select replayed from relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000011', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f05', '019c9100-0000-7000-8000-000000000f05',
    extensions.digest('end-ok', 'sha256'))),
  false,
  'un owner termina la suplencia'
);

-- Leído de la tabla, no de lo que la función dice: un `update` que no encuentra
-- filas devuelve éxito sin escribir nada.
select is(
  (select status::text from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000802'),
  'ended',
  'la fila queda cerrada'
);

select ok(
  (select valid_to is not null and valid_to <= clock_timestamp()
   from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000802'),
  'con la hora en que se cortó, no en el futuro'
);

-- ———————————————————————————————————— Criterio 1

select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000013', true);

select ok(
  not relationships.actor_is_assigned('019c9100-0000-7000-8000-000000000701'),
  'la suplente deja de leer la relación en el acto, sin proceso que la apague'
);

-- ———————————————————————————————————— Criterio 2

-- Leído por el owner. Elena acaba de perder el acceso, así que preguntárselo a
-- ella devolvería `NULL` y se leería como «el titular desapareció».
select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000011', true);

select is(
  (select status::text from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000801'),
  'active',
  'el titular sigue siendo el titular'
);

select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000012', true);

select ok(
  relationships.actor_is_assigned('019c9100-0000-7000-8000-000000000701'),
  'y sigue leyendo a su cliente: terminar una suplencia le devuelve la atención'
);

select is(
  (select status::text from relationships.service_relationships
   where id = '019c9100-0000-7000-8000-000000000701'),
  'active',
  'la relación no se toca'
);

-- ———————————————————————————————————— Criterio 3

select is(
  (select membership_id from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000802'),
  '019c9100-0000-7000-8000-000000000203'::uuid,
  'la fila conserva de quién fue la suplencia: cerrar no borra la autoría'
);

select ok(
  (select accepted_by_person_at is not null
   from relationships.relationship_professional_assignments
   where id = '019c9100-0000-7000-8000-000000000802'),
  'y conserva que la persona la había aceptado'
);

-- ———————————————————————————————————— La historia

select set_config('app.actor_person_id', '019c9100-0000-7000-8000-000000000011', true);

select is(
  (select count(*)::int
   from jsonb_array_elements(
     relationships.read_relationship_history(
       '019c9100-0000-7000-8000-000000000011', '019c9100-0000-7000-8000-000000000101',
       '019c9100-0000-7000-8000-000000000701', 50, null) -> 'data') as entry
   where entry ->> 'type' = 'substitution_ended'),
  1,
  'la historia de la relación lo muestra, derivado de la fila'
);

-- ———————————————————————————————————— Converge

select is(
  (select replayed from relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000011', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f05', '019c9100-0000-7000-8000-000000000f05',
    extensions.digest('end-ok', 'sha256'))),
  true,
  'la misma orden otra vez converge en vez de fallar'
);

-- Y una orden distinta sobre algo ya terminado tampoco falla: quien la mandó
-- pidió que se acabara y está acabada.
select is(
  (select replayed from relationships.end_substitution(
    '019c9100-0000-7000-8000-000000000011', '019c9100-0000-7000-8000-000000000101',
    '019c9100-0000-7000-8000-000000000701', '019c9100-0000-7000-8000-000000000802',
    '019c9100-0000-7000-8000-000000000f06', '019c9100-0000-7000-8000-000000000f06',
    extensions.digest('end-again', 'sha256'))),
  true,
  'y terminar lo ya terminado tampoco es un error'
);

select * from finish();
rollback;
