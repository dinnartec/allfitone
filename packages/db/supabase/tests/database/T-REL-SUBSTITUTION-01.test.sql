-- T-REL-SUBSTITUTION-01 — OP-REL-004.
--
-- Proponer una suplencia, y las dos cosas que la separan de reasignar.
--
-- La primera es quién puede pedirla. Reasignar exige `assign_professionals`, y
-- quien lo tiene ve el directorio entero; proponer una suplencia la puede pedir
-- el propio titular, que es un coach y en esta tabla no ve más que sus propias
-- asignaciones. Por eso hay una aserción dedicada a que el titular pueda: la
-- operación funcionaba para un administrador y fallaba para él, y ninguna
-- prueba escrita desde el lado del administrador lo habría visto.
--
-- La segunda es que proponer no da acceso. Las cinco aserciones sobre
-- `actor_is_assigned` son el criterio 3, el 4, el 5 y el 8: hasta que la persona
-- acepta no se lee nada, el silencio no es aceptación, una suplencia acordada
-- para el mes que viene no sirve hoy, y la que venció ayer deja de servir sin
-- que ningún proceso nocturno tenga que pasar a apagarla.
--
-- La tercera aserción que pesa es la del índice. El criterio 9 dice que pedir
-- dos veces no deja dos suplencias pendientes iguales, y eso es un índice único
-- y no una consulta previa: dos peticiones a la vez no se ven entre sí.

begin;

select plan(32);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c9000-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active', 'ana@example.test'),
  ('019c9000-0000-7000-8000-000000000002', 'Bruno', 'Cliente', 'active', 'bruno@example.test'),
  ('019c9000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active', null),
  ('019c9000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active', null),
  ('019c9000-0000-7000-8000-000000000013', 'Elena', 'Coach', 'active', null),
  ('019c9000-0000-7000-8000-000000000014', 'Sara', 'Staff', 'active', null),
  ('019c9000-0000-7000-8000-000000000015', 'Rita', 'Coach', 'active', null),
  ('019c9000-0000-7000-8000-000000000016', 'Tomás', 'Ajeno', 'active', null);

-- Sin forma de preguntarle. La suplencia es una pregunta que se le hace a la
-- persona, así que una persona sin contacto no puede tener una pendiente.
insert into identity.people (id, given_name, family_name, status)
values ('019c9000-0000-7000-8000-000000000003', 'Nadia', 'SinCorreo', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019c9000-0000-7000-8000-000000000101', 'gym', 'Cover Gym',
  '{"party_kind":"legal_entity","party_name":"Cover SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c9000-0000-7000-8000-000000000201', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000011', 'active'),
  ('019c9000-0000-7000-8000-000000000202', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000012', 'active'),
  ('019c9000-0000-7000-8000-000000000203', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000013', 'active'),
  ('019c9000-0000-7000-8000-000000000204', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000014', 'active'),
  ('019c9000-0000-7000-8000-000000000205', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000015', 'active'),
  ('019c9000-0000-7000-8000-000000000206', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000016', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c9000-0000-7000-8000-000000000201', 'owner'),
  ('019c9000-0000-7000-8000-000000000202', 'coach'),
  ('019c9000-0000-7000-8000-000000000203', 'coach'),
  ('019c9000-0000-7000-8000-000000000204', 'staff'),
  ('019c9000-0000-7000-8000-000000000205', 'coach'),
  ('019c9000-0000-7000-8000-000000000206', 'coach');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000001',
    '019c9000-0000-7000-8000-000000000101', 'active'),
  -- Bruno, sin titular: no hay a quién cubrir. Es otra persona porque
  -- `uidx_service_relationships_active` admite una sola relación activa por
  -- persona y organización.
  ('019c9000-0000-7000-8000-000000000702', '019c9000-0000-7000-8000-000000000002',
    '019c9000-0000-7000-8000-000000000101', 'active'),
  ('019c9000-0000-7000-8000-000000000703', '019c9000-0000-7000-8000-000000000003',
    '019c9000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values
  ('019c9000-0000-7000-8000-000000000801', '019c9000-0000-7000-8000-000000000701',
    '019c9000-0000-7000-8000-000000000001', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000202', 'holder', 'active'),
  ('019c9000-0000-7000-8000-000000000803', '019c9000-0000-7000-8000-000000000703',
    '019c9000-0000-7000-8000-000000000003', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000202', 'holder', 'active');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- El owner propone que Elena cubra a Camilo la semana que viene.
select is(
  (select proposed from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f01', '019c9000-0000-7000-8000-000000000f01',
    extensions.digest('cover-1', 'sha256'))),
  true,
  'un owner propone una suplencia'
);

select is(
  (select status::text || '/' || kind::text
   from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and membership_id = '019c9000-0000-7000-8000-000000000203'),
  'proposed/substitute',
  'y queda pendiente, no vigente'
);

select is(
  (select accepted_by_person_at
   from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and membership_id = '019c9000-0000-7000-8000-000000000203'),
  null,
  'sin aceptación de nadie: el silencio no es aceptación'
);

/*
 * Criterio 6. El aviso es una fila del outbox escrita por la propia función, así
 * que existe dentro de esta misma transacción: no hay camino donde la suplencia
 * quede propuesta y a la persona no se le pregunte.
 */
select is(
  (select count(*)::int from system.outbox_events
   where event_type = 'relationship.substitution_proposed.v1'
     and aggregate_id = '019c9000-0000-7000-8000-000000000701'),
  1,
  'la pregunta a la persona queda encolada en la misma transacción'
);

-- El worker no puede leer relaciones ni personas: esas políticas existen para
-- mantenerlo fuera. Así que el evento tiene que llevar el correo ya redactado.
select is(
  (select (payload ->> 'contact') || ' · ' || (payload ->> 'substitute_name')
       || ' por ' || (payload ->> 'holder_name')
   from system.outbox_events
   where event_type = 'relationship.substitution_proposed.v1'),
  'ana@example.test · Elena Coach por Camilo Coach',
  'y dice a dónde va, quién cubre y a quién cubre'
);

select is(
  (select (payload ->> 'starts_on') || ' → ' || (payload ->> 'ends_on')
   from system.outbox_events
   where event_type = 'relationship.substitution_proposed.v1'),
  (current_date + 3)::text || ' → ' || (current_date + 10)::text,
  'y las fechas, que es lo que la persona tiene que decidir'
);

/*
 * La segunda mitad del criterio 9: la decisión queda en el historial. Y queda
 * fechada el día en que se pidió, no el día en que empezaría — una propuesta
 * hecha hoy para dentro de tres días encabezaba una lista ordenada de lo más
 * reciente a lo más antiguo con una fecha que todavía no ha llegado.
 */
select is(
  (select (event ->> 'occurred_at')::date
   from jsonb_array_elements(
     relationships.read_relationship_history(
       '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
       '019c9000-0000-7000-8000-000000000701', null, null) -> 'data'
   ) as event
   where event ->> 'type' = 'substitution_proposed'),
  current_date,
  'la propuesta aparece en el historial fechada el día en que se pidió'
);

-- Y con las dos puntas de la ventana, que es lo que la persona decidió.
select is(
  (select (event -> 'detail' ->> 'starts_on') || ' → ' || (event -> 'detail' ->> 'ends_on')
   from jsonb_array_elements(
     relationships.read_relationship_history(
       '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
       '019c9000-0000-7000-8000-000000000701', null, null) -> 'data'
   ) as event
   where event ->> 'type' = 'substitution_proposed'),
  (current_date + 3)::text || ' → ' || (current_date + 10)::text,
  'y dice desde cuándo y hasta cuándo, no solo hasta cuándo'
);

-- Criterio 3 y 4: proponer no da acceso a nada.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000013', true);

select is(
  (select relationships.actor_is_assigned('019c9000-0000-7000-8000-000000000701')),
  false,
  'la suplente propuesta no lee nada hasta que la persona acepte'
);

select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000011', true);

/*
 * El mismo comando otra vez: un reintento después de un tiempo de espera que
 * quien llamó nunca vio resolverse.
 */
select is(
  (select replayed from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f01', '019c9000-0000-7000-8000-000000000f01',
    extensions.digest('cover-1', 'sha256'))),
  true,
  'el mismo comando repetido se reconoce como reintento'
);

/*
 * Criterio 9, la aserción que vigila el índice. Esto es otro comando: otra clave
 * de idempotencia, misma intención. Un `select` previo y un `insert` después no
 * podrían prometerlo — dos a la vez no leen nada y escriben los dos.
 */
select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f02', '019c9000-0000-7000-8000-000000000f02',
    extensions.digest('cover-2', 'sha256'))$$,
  '23505',
  -- El texto lo redacta PostgreSQL y nombra el índice; se comprueba el código,
  -- que es lo que el handler traduce a 409.
  null,
  'dos veces la misma suplencia pendiente no son dos suplencias'
);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and kind = 'substitute'),
  1,
  'y la tabla sigue con una sola'
);

-- Otra ventana sí es otra pregunta: el criterio habla de la misma ventana.
select is(
  (select proposed from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000203',
    current_date + 20, current_date + 25,
    '019c9000-0000-7000-8000-000000000f03', '019c9000-0000-7000-8000-000000000f03',
    extensions.digest('cover-3', 'sha256'))),
  true,
  'la misma suplente en otras fechas es otra suplencia'
);

/*
 * El titular pide su propia suplencia, que es el actor `A3` del catálogo y el
 * que esta operación casi deja fuera: es un coach, y en esta tabla un coach no
 * ve más que sus propias asignaciones. Si la función leyera de vuelta la fila
 * que acaba de escribir — con la ficha de Rita, no la suya — esto fallaría
 * después de haber escrito.
 */
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000012', true);

select is(
  (select proposed from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000012', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000205',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f04', '019c9000-0000-7000-8000-000000000f04',
    extensions.digest('cover-4', 'sha256'))),
  true,
  'el titular propone quién le cubre, sin repartir responsables'
);

-- Una coach que no atiende a Ana no sabe ni que Ana existe. `P0002` y no
-- `42501`: un «no tienes permiso» confirmaría la relación.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000013', true);

select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000013', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000205',
    current_date + 30, current_date + 35,
    '019c9000-0000-7000-8000-000000000f05', '019c9000-0000-7000-8000-000000000f05',
    extensions.digest('cover-5', 'sha256'))$$,
  'P0002',
  'relationship not found',
  'una coach ajena a la relación no llega ni a saber que existe'
);

select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000014', true);

select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000014', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000205',
    current_date + 30, current_date + 35,
    '019c9000-0000-7000-8000-000000000f06', '019c9000-0000-7000-8000-000000000f06',
    extensions.digest('cover-6', 'sha256'))$$,
  '42501',
  'proposing a substitution requires assign_professionals or being the holder',
  'recepción no decide quién atiende a nadie'
);

select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000204',
    current_date + 30, current_date + 35,
    '019c9000-0000-7000-8000-000000000f07', '019c9000-0000-7000-8000-000000000f07',
    extensions.digest('cover-7', 'sha256'))$$,
  '42501',
  'a substitute must be an active coach of this organization',
  'y quien cubre tiene que ser coach, igual que quien titula'
);

select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000202',
    current_date + 30, current_date + 35,
    '019c9000-0000-7000-8000-000000000f08', '019c9000-0000-7000-8000-000000000f08',
    extensions.digest('cover-8', 'sha256'))$$,
  'P0004',
  'the holder cannot stand in for themselves',
  'cubrirse a uno mismo no es cubrir'
);

-- El límite con OP-REL-002: sin titular no hay a quién cubrir.
select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000702', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f09', '019c9000-0000-7000-8000-000000000f09',
    extensions.digest('cover-9', 'sha256'))$$,
  'P0004',
  'this relationship has no holder to cover for',
  'una relación sin titular no se cubre: se asigna'
);

-- «Sin fecha de fin, rechazo», del catálogo. `22023` y no `P0004` porque el
-- handler convierte uno en 422 y el otro en 409.
select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, null,
    '019c9000-0000-7000-8000-000000000f0a', '019c9000-0000-7000-8000-000000000f0a',
    extensions.digest('cover-10', 'sha256'))$$,
  '22023',
  'a substitution needs a start and an end',
  'una suplencia sin fecha de fin no es una suplencia'
);

/*
 * Falla cerrado: una pregunta que no se le puede hacer a nadie no queda
 * pendiente. Si pasara, habría una profesional esperando una respuesta que no
 * va a llegar, en una fila que parece pedida.
 */
select throws_ok(
  $$select * from relationships.propose_substitution(
    '019c9000-0000-7000-8000-000000000011', '019c9000-0000-7000-8000-000000000101',
    '019c9000-0000-7000-8000-000000000703', '019c9000-0000-7000-8000-000000000203',
    current_date + 3, current_date + 10,
    '019c9000-0000-7000-8000-000000000f0b', '019c9000-0000-7000-8000-000000000f0b',
    extensions.digest('cover-11', 'sha256'))$$,
  'P0004',
  'the person has no contact to be asked about a substitution',
  'sin forma de preguntarle, no se propone'
);

/*
 * Lo que la persona cambia al aceptar, y los dos bordes de la ventana.
 *
 * Estas cuatro aserciones son la razón por la que el arreglo de
 * `actor_is_assigned` va en la misma migración que la operación: la fórmula no
 * miraba `ends_on` ni `valid_from`, y la primera suplencia vencida habría dado
 * acceso para siempre.
 */
update relationships.relationship_professional_assignments
set status = 'active', accepted_by_person_at = clock_timestamp()
where relationship_id = '019c9000-0000-7000-8000-000000000701'
  and membership_id = '019c9000-0000-7000-8000-000000000203'
  and ends_on = current_date + 10;

select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000013', true);

select is(
  (select relationships.actor_is_assigned('019c9000-0000-7000-8000-000000000701')),
  false,
  'aceptada pero sin empezar todavía no lee nada'
);

update relationships.relationship_professional_assignments
set valid_from = clock_timestamp() - interval '1 day'
where relationship_id = '019c9000-0000-7000-8000-000000000701'
  and membership_id = '019c9000-0000-7000-8000-000000000203'
  and ends_on = current_date + 10;

select is(
  (select relationships.actor_is_assigned('019c9000-0000-7000-8000-000000000701')),
  true,
  'aceptada y en curso sí'
);

/*
 * Criterio 8, el que no admite un proceso posterior. La suplencia venció ayer y
 * el acceso se corta leyendo la fecha, sin que nadie haya pasado a cambiar el
 * estado: un proceso que todavía no se ha ejecutado es un proceso que sigue
 * dando un acceso que ya no toca.
 */
update relationships.relationship_professional_assignments
set ends_on = current_date - 1
where relationship_id = '019c9000-0000-7000-8000-000000000701'
  and membership_id = '019c9000-0000-7000-8000-000000000203'
  and status = 'active';

select is(
  (select relationships.actor_is_assigned('019c9000-0000-7000-8000-000000000701')),
  false,
  'vencida ayer deja de leer hoy, sin esperar a ningún proceso nocturno'
);

-- Y el titular, que no tiene ventana, sigue leyendo en todos los casos.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000012', true);

select is(
  (select relationships.actor_is_assigned('019c9000-0000-7000-8000-000000000701')),
  true,
  'el titular no tiene fecha de fin y sigue atendiendo'
);

/*
 * ———————————————————————————————————— Quién puede leer una suplencia
 *
 * La mitad que faltaba. El titular puede pedir una suplencia desde el día que
 * `OP-REL-004` existe, y hasta hoy no podía leerla: la política identifica a un
 * coach por `membership_id`, y una suplencia lleva la ficha del suplente. Quien
 * pide que le cubran y nunca sabe si aceptaron se va sin saber si su clienta
 * queda atendida.
 *
 * La fila dice ahora a quién cubre, y el predicado sigue siendo local a la
 * fila: preguntar `actor_is_assigned` aquí recurre, porque esa función lee esta
 * misma tabla — la migración original ya lo dejó anotado como intentado y
 * fallido.
 */
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000011', true);

select is(
  (select covers_membership_id from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and membership_id = '019c9000-0000-7000-8000-000000000205'),
  '019c9000-0000-7000-8000-000000000202'::uuid,
  'la suplencia registra a qué titular cubre'
);

-- La aserción por la que existe todo esto: Camilo pidió que le cubrieran y
-- puede ver el resultado.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000012', true);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and membership_id = '019c9000-0000-7000-8000-000000000205'),
  1,
  'el titular lee la suplencia que él mismo propuso'
);

-- Y la lee donde la pantalla la busca, no solo en la tabla.
select is(
  (select jsonb_array_length(
     relationships.read_relationship_state(
       '019c9000-0000-7000-8000-000000000012', '019c9000-0000-7000-8000-000000000101',
       '019c9000-0000-7000-8000-000000000701') -> 'substitutions')),
  3,
  'y la ficha del vínculo se la devuelve, que antes le llegaba vacía'
);

-- Rita es la suplente: su propia ficha ya la veía, y lo sigue haciendo.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000015', true);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'
     and membership_id = '019c9000-0000-7000-8000-000000000205'),
  1,
  'la suplente sigue viendo la suya'
);

/*
 * Y lo que NO se amplió. Tomás es coach de la organización, no atiende a Ana y
 * no cubre a nadie: no ve ninguna fila de esta relación. Si esta aserción se
 * cae, la política se abrió de más.
 *
 * Tiene que ser él y no Elena: Elena es la suplente propuesta en dos
 * coberturas, así que ve sus propias filas por `owns_membership(membership_id)`,
 * que es la regla de siempre y no lo que aquí se está midiendo.
 */
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000016', true);

select is(
  (select count(*)::int from relationships.relationship_professional_assignments
   where relationship_id = '019c9000-0000-7000-8000-000000000701'),
  0,
  'un coach ajeno a la relación no ve ninguna de sus asignaciones'
);

-- Las dos restricciones que sostienen la política: si una suplencia pudiera no
-- decir a quién cubre, habría filas que el titular nunca vería.
select set_config('app.actor_person_id', '019c9000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$insert into relationships.relationship_professional_assignments
    (relationship_id, person_id, organization_id, membership_id, kind, status, ends_on)
    values ('019c9000-0000-7000-8000-000000000701', '019c9000-0000-7000-8000-000000000001',
            '019c9000-0000-7000-8000-000000000101', '019c9000-0000-7000-8000-000000000203',
            'substitute', 'proposed', current_date + 5)$$,
  '23514',
  null,
  'una suplencia que no dice a quién cubre no se escribe'
);

select throws_ok(
  $$update relationships.relationship_professional_assignments
    set covers_membership_id = '019c9000-0000-7000-8000-000000000203'
    where id = '019c9000-0000-7000-8000-000000000801'$$,
  '23514',
  null,
  'y un titular no cubre a nadie'
);

select * from finish();

rollback;
