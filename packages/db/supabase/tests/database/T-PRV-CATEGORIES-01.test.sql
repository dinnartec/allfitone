-- T-PRV-CATEGORIES-01 — OP-PRV-022, las palabras de cada categoría de información.
--
-- `HU-STUDIO-034`. La aserción que de verdad justifica esta operación es la
-- primera: responde **sin una sola definición publicada**. `privacy.scope_definitions`
-- nace vacía porque sus reglas de campo son curaduría de Backoffice, y
-- `list_offerable_scopes` no dice nada hasta que alguien las publique. Si esta
-- función se hubiera colgado de aquella —la tentación obvia, porque ya existe—
-- heredaría un bloqueo que la historia no tiene.
--
-- El segundo criterio, «la definición es fija y no cambia bajo mis pies», no se
-- comprueba con una aserción sino con la forma de la tabla: `scope_presentations`
-- no tiene columna de versión. Leerlo por `scope_definitions` sí movería la
-- versión bajo los pies del lector el día que alguien publique una segunda.

begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b4000-0000-7000-8000-000000000001', 'Camila', 'Coach', 'active'),
  ('019b4000-0000-7000-8000-000000000002', 'Sofía', 'Soporte', 'active');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b4000-0000-7000-8000-000000000001', true);

-- Nada se publicó en el montaje: la tabla de definiciones sigue vacía, como en
-- producción. Esta es la aserción que separa esta operación de `OP-PRV-012`.
select is(
  (select count(*)::int from privacy.scope_definitions),
  0,
  'no hay ninguna definición de scope publicada'
);

select is(
  (select count(*)::int from privacy.list_information_categories()),
  7,
  'y aun así se leen las siete categorías'
);

select is(
  (select display_name from privacy.list_information_categories()
   where scope_code = 'health_context'),
  'Contexto de salud',
  'cada una se presenta con su nombre, no con su código'
);

-- Criterio 1: qué incluye y qué excluye. La mitad que excluye vive en la
-- descripción, y es la que impide que alguien marque «cuerpo» creyendo que
-- alcanza lesiones.
select ok(
  (select description like '%No incluye%' from privacy.list_information_categories()
   where scope_code = 'relationship_training'),
  'la descripción dice dónde para el permiso'
);

select isnt(
  (select summary from privacy.list_information_categories()
   where scope_code = 'body_progress'),
  null,
  'y trae además el resumen de una línea'
);

select isnt(
  (select default_purpose from privacy.list_information_categories()
   where scope_code = 'nutrition_media'),
  null,
  'con la finalidad fija que el gimnasio no redacta'
);

-- El orden es el de la historia: entrenamiento, historial previo, cuerpo, salud
-- y después las de nutrición. Alfabético por código las dispersaría.
select is(
  (select array_agg(scope_code) from privacy.list_information_categories()),
  array[
    'relationship_training', 'prior_training_history', 'body_progress',
    'health_context', 'nutrition_intake', 'nutrition_media', 'nutrition_guidance'
  ],
  'se leen en el orden en que la historia las nombra'
);

-- Ninguna categoría se queda sin palabras. Las dos listas de códigos viven en
-- dos check constraints porque V1 no tiene enum, así que un código añadido a
-- una y olvidado en la otra llegaría a la pantalla como su código técnico.
select is(
  (select count(*)::int from privacy.list_information_categories()
   where btrim(display_name) = '' or btrim(description) = ''),
  0,
  'ninguna llega con un texto vacío'
);

/*
 * Un actor de Backoffice es rechazado, no atendido con una lista vacía. La
 * política de la tabla solo admite `person`, así que sin esta guarda soporte
 * leería cero filas y concluiría que no hay categorías — una respuesta
 * equivocada con forma de respuesta correcta.
 */
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b4000-0000-7000-8000-000000000002', true);

select throws_ok(
  'select * from privacy.list_information_categories()',
  '42501',
  'active person required',
  'soporte recibe una negativa, no una lista vacía'
);

select set_config('app.actor_kind', 'anonymous', true),
       set_config('app.actor_person_id', '', true);

select throws_ok(
  'select * from privacy.list_information_categories()',
  '42501',
  'active person required',
  'y un actor anónimo tampoco lee el vocabulario'
);

-- La función es estable y de solo lectura: no escribe un evento de acceso
-- porque no hay datos de ninguna persona que registrar.
select is(
  (select provolatile::text from pg_proc
   where oid = 'privacy.list_information_categories()'::regprocedure),
  's',
  'la operación es una consulta estable, sin efectos'
);

select * from finish();

rollback;
