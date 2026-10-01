-- T-PRV-SCOPE-PRESENTATION-01 — OP-REL-001, el vocabulario que una invitación usa.
--
-- The assertion that carries the most weight is the last one: every code the
-- schema admits has words for it. Nothing else enforces that — the two lists
-- live in two check constraints because V1 has no enum to point at — so a code
-- added to one and forgotten in the other would reach a professional as a bare
-- `nutrition_media` on screen, or as a scope that cannot be offered at all.

begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values ('019b3000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active');

/*
 * Las definiciones las publica Backoffice en caliente, no una migración: sus
 * reglas de campo son una decisión de curaduría. La tabla nace vacía, así que
 * la prueba publica las siete que V1 declara, igual que hacen las demás.
 */
insert into privacy.scope_definitions (scope_code, version_number, status, published_at)
select code, 1, 'published', clock_timestamp()
from unnest(array[
  'relationship_training', 'prior_training_history', 'body_progress',
  'health_context', 'nutrition_intake', 'nutrition_guidance', 'nutrition_media'
]) as published(code);

-- Un borrador conviviendo con la publicada desde el principio. Se crea aquí y
-- no más abajo porque la política de la tabla no admite escrituras del actor
-- persona, que es justamente lo que se quiere.
insert into privacy.scope_definitions (scope_code, version_number, status)
values ('body_progress', 99, 'draft');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true);

select is(
  (select count(*)::int from privacy.list_offerable_scopes()),
  7,
  'los siete scopes de V1 se pueden ofrecer'
);

select is(
  (select display_name from privacy.list_offerable_scopes()
   where scope_code = 'body_progress'),
  'Progreso corporal',
  'cada uno tiene un nombre legible, no su código'
);

select isnt(
  (select description from privacy.list_offerable_scopes()
   where scope_code = 'health_context'),
  null,
  'y una descripción de qué cubre'
);

-- Lo que un scope excluye importa tanto como lo que incluye: quien decide si un
-- gimnasio puede leer sus lesiones merece saber dónde está el límite.
select ok(
  (select description like '%No incluye%' from privacy.list_offerable_scopes()
   where scope_code = 'health_context'),
  'la descripción dice también lo que el permiso no alcanza'
);

select isnt(
  (select default_purpose from privacy.list_offerable_scopes()
   where scope_code = 'nutrition_intake'),
  null,
  'y una finalidad fija, que el gimnasio no redacta'
);

select is(
  (select version_number from privacy.list_offerable_scopes()
   where scope_code = 'body_progress'),
  (select max(version_number) from privacy.scope_definitions
   where scope_code = 'body_progress' and status = 'published'),
  'se ofrece la última versión publicada de cada contrato'
);

-- Una versión en borrador no se ofrece: nadie puede aceptar un contrato que
-- todavía no existe. El borrador se creó en el montaje, conviviendo con la
-- versión publicada del mismo código.
select is(
  (select count(*)::int from privacy.list_offerable_scopes()),
  7,
  'un borrador no aparece entre lo ofrecible'
);

select is(
  (select version_number from privacy.list_offerable_scopes()
   where scope_code = 'body_progress'),
  (select max(version_number) from privacy.scope_definitions
   where scope_code = 'body_progress' and status = 'published'),
  'y no desplaza a la versión publicada'
);

-- El actor anónimo no lee el catálogo. No lleva datos de nadie, pero tampoco
-- hay razón para publicarlo antes de iniciar sesión.
select set_config('app.actor_kind', 'anonymous', true),
       set_config('app.actor_person_id', '', true);

select is(
  (select count(*)::int from privacy.list_offerable_scopes()),
  0,
  'un actor anónimo no lee el catálogo de permisos'
);

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true);

select is(
  (select count(*)::int from privacy.scope_presentations),
  7,
  'la tabla tiene una presentación por código'
);

/*
 * La que de verdad protege algo. `ck_scope_definitions_code` y
 * `ck_scope_presentations_code` admiten la misma lista de siete, escrita dos
 * veces porque no hay enum. Si alguien añade un código a una y olvida la otra,
 * ese scope llega a la pantalla como su código técnico o no se puede ofrecer.
 */
select is(
  (select array_agg(distinct scope_code order by scope_code)
   from privacy.scope_definitions where status = 'published'),
  (select array_agg(scope_code order by scope_code)
   from privacy.scope_presentations),
  'ningún código publicado se queda sin palabras'
);

select * from finish();

rollback;
