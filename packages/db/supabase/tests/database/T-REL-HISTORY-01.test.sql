-- T-REL-HISTORY-01 — OP-REL-014.
--
-- Qué puede contar una relación sobre su pasado, a quién, y qué se calla.
--
-- Tres aserciones pesan más que las demás:
--
-- La primera es el relevo. Reasignar cierra una asignación y abre la siguiente
-- en la misma transacción, así que `holder_ended` y `holder_assigned` comparten
-- el instante exacto. El cursor lleva tres campos justamente por eso, y lo que
-- se comprueba aquí no es que paginar funcione, sino que **paginar por el medio
-- de un instante compartido no duplica ni se salta un evento**. Con un cursor de
-- dos campos ese es el borde que falla, y solo se nota cuando ya hay historia
-- suficiente para una segunda página.
--
-- La segunda es el motivo de terminación. El criterio 3 dice que solo se ve si
-- lo declaramos nosotros, y la comprobación no mira solo el campo `reason`: mira
-- que el texto no aparezca **en ninguna parte** del documento. Un motivo filtrado
-- del campo correcto y copiado en otro seguiría siendo una fuga.
--
-- La tercera es que un coach lee una historia más corta que un owner. No es una
-- carencia: la política de filas le muestra su propia asignación y ninguna otra,
-- así que el coach entrante no se entera de quién atendía a esta persona antes
-- de él. Si algún día esa política se amplía, este test se cae y obliga a
-- decidirlo a propósito.

begin;

select plan(16);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c8000-0000-7000-8000-000000000001', 'Ana', 'Cliente', 'active'),
  ('019c8000-0000-7000-8000-000000000002', 'Bruno', 'Cliente', 'active'),
  ('019c8000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019c8000-0000-7000-8000-000000000012', 'Camilo', 'Saliente', 'active'),
  ('019c8000-0000-7000-8000-000000000013', 'Diana', 'Entrante', 'active'),
  ('019c8000-0000-7000-8000-000000000014', 'Elena', 'Ajena', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c8000-0000-7000-8000-000000000101', 'gym', 'History Gym',
    '{"party_kind":"legal_entity","party_name":"History SAS","purpose":"studio_operations"}'),
  ('019c8000-0000-7000-8000-000000000102', 'gym', 'Otro Gym',
    '{"party_kind":"legal_entity","party_name":"Otro SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c8000-0000-7000-8000-000000000201', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000011', 'active'),
  ('019c8000-0000-7000-8000-000000000202', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000012', 'active'),
  ('019c8000-0000-7000-8000-000000000203', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000013', 'active'),
  ('019c8000-0000-7000-8000-000000000204', '019c8000-0000-7000-8000-000000000102',
    '019c8000-0000-7000-8000-000000000014', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c8000-0000-7000-8000-000000000201', 'owner'),
  ('019c8000-0000-7000-8000-000000000202', 'coach'),
  ('019c8000-0000-7000-8000-000000000203', 'coach'),
  ('019c8000-0000-7000-8000-000000000204', 'owner');

-- El vínculo de Ana: abierto, con un relevo de responsable, un consentimiento, y
-- cerrado por la organización declarando un motivo.
insert into relationships.service_relationships
  (id, person_id, organization_id, status, started_at, ended_at, ended_reason, ended_by_kind)
values
  ('019c8000-0000-7000-8000-000000000701', '019c8000-0000-7000-8000-000000000001',
    '019c8000-0000-7000-8000-000000000101', 'terminated',
    now() - interval '10 days', now() - interval '1 day',
    'Dejo de asistir sin avisar', 'professional'),
  -- El de Bruno lo cerró él, y dio su razón. Studio no la lee.
  ('019c8000-0000-7000-8000-000000000702', '019c8000-0000-7000-8000-000000000002',
    '019c8000-0000-7000-8000-000000000101', 'terminated',
    now() - interval '10 days', now() - interval '2 days',
    'El trato no me gusto', 'person');

/*
 * El relevo. `valid_to` del saliente y `valid_from` del entrante son el mismo
 * instante a propósito: es lo que hace `reassign_relationship_holder` dentro de
 * una transacción, y es el borde que el cursor tiene que soportar.
 */
insert into relationships.relationship_professional_assignments
  (id, relationship_id, person_id, organization_id, membership_id, kind, status, valid_from, valid_to)
values
  ('019c8000-0000-7000-8000-000000000801', '019c8000-0000-7000-8000-000000000701',
    '019c8000-0000-7000-8000-000000000001', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000202', 'holder', 'ended',
    now() - interval '9 days', now() - interval '5 days'),
  ('019c8000-0000-7000-8000-000000000802', '019c8000-0000-7000-8000-000000000701',
    '019c8000-0000-7000-8000-000000000001', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000203', 'holder', 'active',
    now() - interval '5 days', null);

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019c8000-0000-7000-8000-000000000301', 'health_context', 2, 'published',
  now() - interval '20 days');

insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values (
  '019c8000-0000-7000-8000-000000000401', '019c8000-0000-7000-8000-000000000101',
  '019c8000-0000-7000-8000-000000000201', 'email', 'ana@example.test',
  extensions.digest('history-token', 'sha256'), 1,
  extensions.digest('history-proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"History SAS","purpose":"studio_operations"}',
  'completed', now() + interval '7 days'
);

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values ('019c8000-0000-7000-8000-000000000501', '019c8000-0000-7000-8000-000000000401',
  'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values (
  '019c8000-0000-7000-8000-000000000601', '019c8000-0000-7000-8000-000000000501',
  '019c8000-0000-7000-8000-000000000301', 'health_context', 'read',
  'Adaptar el entrenamiento', '{"title":"Contexto de salud"}'::jsonb,
  'accepted', now() - interval '8 days'
);

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot, decided_at
) values (
  '019c8000-0000-7000-8000-000000000901', '019c8000-0000-7000-8000-000000000001',
  '019c8000-0000-7000-8000-000000000701', '019c8000-0000-7000-8000-000000000101',
  '019c8000-0000-7000-8000-000000000601', '019c8000-0000-7000-8000-000000000301',
  'health_context', 'accepted', '{"title":"Contexto de salud"}'::jsonb,
  now() - interval '8 days'
);

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- ———————————————————————————————————————— el owner lee la historia completa

select is(
  (select jsonb_array_length(
            relationships.read_relationship_history(
              '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
              '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data')),
  6,
  'un owner lee los seis eventos del vinculo'
);

select is(
  (select string_agg(entry ->> 'type', ',')
   from jsonb_array_elements(
          relationships.read_relationship_history(
            '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
            '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data') as entry),
  'relationship_ended,holder_assigned,holder_ended,consent_decided,holder_assigned,relationship_started',
  'los eventos salen del mas reciente al mas antiguo'
);

-- El orden no se comprueba leyendo la lista: se comprueba que ningún elemento
-- sea más nuevo que el anterior.
select ok(
  (select bool_and(previous >= current_at)
   from (
     select (entry ->> 'occurred_at')::timestamptz as current_at,
            lag((entry ->> 'occurred_at')::timestamptz) over (order by ordinality) as previous
     from jsonb_array_elements(
            relationships.read_relationship_history(
              '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
              '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data')
          with ordinality as elements(entry, ordinality)
   ) as ordered
   where previous is not null),
  'ningun evento es mas nuevo que el que lo precede'
);

select ok(
  not (relationships.read_relationship_history(
         '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
         '019c8000-0000-7000-8000-000000000701', 50, null) -> 'page' -> 'has_more')::boolean,
  'una pagina que cabe entera no anuncia otra'
);

select is(
  (select relationships.read_relationship_history(
            '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
            '019c8000-0000-7000-8000-000000000701', 50, null) -> 'page' -> 'next_cursor'),
  'null'::jsonb,
  'y no entrega cursor'
);

-- ———————————————————————————————————————— el relevo comparte instante

select is(
  (select count(distinct entry ->> 'occurred_at')
   from jsonb_array_elements(
          relationships.read_relationship_history(
            '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
            '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data') as entry
   where entry ->> 'type' in ('holder_assigned', 'holder_ended')
     and (entry ->> 'occurred_at')::timestamptz = now() - interval '5 days'),
  1::bigint,
  'el cierre del saliente y la apertura del entrante caen en el mismo instante'
);

/*
 * La aserción que justifica el tercer campo del cursor: con límite 2, la
 * segunda página empieza justo dentro del instante compartido. Se recorre la
 * historia entera paginando y se compara el conjunto con la lectura de una sola
 * vez. Un cursor que se salte o repita un evento rompe esta igualdad.
 */
create temporary table history_paged (seen text) on commit drop;

do $$
declare
  page_cursor text := null;
  document jsonb;
  more boolean := true;
  guard integer := 0;
begin
  while more and guard < 20 loop
    guard := guard + 1;
    document := relationships.read_relationship_history(
      '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
      '019c8000-0000-7000-8000-000000000701', 2, page_cursor);
    insert into history_paged (seen)
    select (entry ->> 'occurred_at') || '|' || (entry ->> 'type') || '|' || (entry ->> 'source_id')
    from jsonb_array_elements(document -> 'data') as entry;
    more := (document -> 'page' -> 'has_more')::boolean;
    page_cursor := document -> 'page' ->> 'next_cursor';
  end loop;
end
$$;

select is(
  (select count(*) from history_paged),
  6::bigint,
  'paginar de dos en dos recorre los seis eventos'
);

select is(
  (select count(distinct seen) from history_paged),
  6::bigint,
  'y no repite ninguno al cruzar el instante compartido'
);

select is(
  (select count(*)
   from history_paged
   where seen not in (
     select (entry ->> 'occurred_at') || '|' || (entry ->> 'type') || '|' || (entry ->> 'source_id')
     from jsonb_array_elements(
            relationships.read_relationship_history(
              '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
              '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data') as entry)),
  0::bigint,
  'y el conjunto paginado es el mismo que el de una sola lectura'
);

-- ———————————————————————————————————————— el motivo de terminación

select is(
  (select entry -> 'detail' ->> 'reason'
   from jsonb_array_elements(
          relationships.read_relationship_history(
            '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
            '019c8000-0000-7000-8000-000000000701', 50, null) -> 'data') as entry
   where entry ->> 'type' = 'relationship_ended'),
  'Dejo de asistir sin avisar',
  'el motivo que declaro la organizacion se lee'
);

select is(
  (select entry -> 'detail' ->> 'reason'
   from jsonb_array_elements(
          relationships.read_relationship_history(
            '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
            '019c8000-0000-7000-8000-000000000702', 50, null) -> 'data') as entry
   where entry ->> 'type' = 'relationship_ended'),
  null,
  'el motivo que declaro la persona no se lee'
);

-- No basta vaciar el campo: el texto no puede aparecer en ninguna parte del
-- documento. Un motivo copiado en otra clave seguiria siendo una fuga.
select ok(
  relationships.read_relationship_history(
    '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000702', 50, null)::text
    not like '%El trato no me gusto%',
  'el texto del motivo ajeno no aparece en ningun lugar del documento'
);

select ok(
  not (select entry -> 'detail' -> 'declared_by_us'
       from jsonb_array_elements(
              relationships.read_relationship_history(
                '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
                '019c8000-0000-7000-8000-000000000702', 50, null) -> 'data') as entry
       where entry ->> 'type' = 'relationship_ended')::boolean,
  'y el documento dice que no lo declaramos nosotros, en vez de callar que existe'
);

-- ———————————————————————————————————————— lo que un coach no ve

select set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000013', true);

select ok(
  relationships.read_relationship_history(
    '019c8000-0000-7000-8000-000000000013', '019c8000-0000-7000-8000-000000000101',
    '019c8000-0000-7000-8000-000000000701', 50, null)::text not like '%Camilo%',
  'el coach entrante no se entera de quien atendia antes a esta persona'
);

-- ———————————————————————————————————————— negaciones

select set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000014', true);

select throws_ok(
  $$select relationships.read_relationship_history(
      '019c8000-0000-7000-8000-000000000014', '019c8000-0000-7000-8000-000000000101',
      '019c8000-0000-7000-8000-000000000701', 50, null)$$,
  '42501',
  null,
  'un actor de otra organizacion no lee esta historia'
);

select set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$select relationships.read_relationship_history(
      '019c8000-0000-7000-8000-000000000011', '019c8000-0000-7000-8000-000000000101',
      '019c8000-0000-7000-8000-000000000701', 50, 'esto-no-es-un-cursor')$$,
  '22023',
  null,
  'un cursor que no se puede leer se rechaza en vez de devolver la primera pagina'
);

select finish();

rollback;
