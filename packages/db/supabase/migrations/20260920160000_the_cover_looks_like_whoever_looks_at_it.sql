-- La portada del catálogo se parece a quien la mira — `AFO-186`, segunda revisión de
-- `ADR-031`.
--
-- Las veinticuatro portadas se rehacen con un solo estilo de fotografía y **cambian con
-- el sexo declarado**: quien declaró hombre las ve de hombre, quien declaró mujer de
-- mujer, y quien prefirió no decirlo las ve mezcladas.
--
-- **Son dos juegos y no tres.** «Mixto» no es un tercer juego de fotografías: es lo que
-- se ve cuando el carrusel alterna entre los dos. Un tercer juego serían veinticuatro
-- imágenes más para decir lo mismo, y además tendría que decidir qué significa «mixto»
-- en una sola fotografía, que es una pregunta sin respuesta.
--
-- **El vocabulario ya existía y encaja.** `identity.people.biological_sex` es `male` o
-- `female` y admite nulo, y el nulo no es «sin contestar» sino la negativa: el contrato
-- la exige en vez de omitirla, y por eso `identity.onboarding_attempts` lleva un
-- `biological_sex_answered_at`. Las tres audiencias del encargo son exactamente los tres
-- estados que una persona puede tener, así que no se inventa ninguno, no se añade
-- columna a `identity` y no se guarda nada por persona: esto es una lectura y no un
-- registro.
--
-- **Con la negativa se elige por el identificador del programa**, deterministamente y no
-- al azar. Una portada que sorteara la audiencia en cada lectura sería una portada
-- distinta cada vez que la pantalla se refresca; así el catálogo sale mezclado y sale
-- siempre igual.
--
-- **`planning.programs.cover_object_key` se retira.** Una columna sostiene una portada y
-- aquí hay dos, y dejar la columna al lado de la tabla serían dos verdades sobre la
-- misma cara. Todo lo que la leía pasa por `planning.cover_for`.
--
-- **Lo que la columna decía de un programa propio se dice ahora por referencia.** Un
-- programa que alguien escribe aquí no tiene fotografías suyas: toma prestada la de un
-- programa del catálogo que trabaja la misma región, y eso se decidía al publicar y se
-- guardaba porque una portada que cambiara al añadir un ejercicio sería una tarjeta
-- distinta cada vez que alguien edita. Se sigue decidiendo al publicar y se sigue
-- guardando, pero ahora se guarda **de quién** y no **cuál**: `cover_from_program_id`.
-- Es lo único que deja que la copia tenga también sus dos juegos, y es lo que hace que
-- una bifurcación conserve la cara con la que se eligió el programa en vez de recibir
-- otra por el camino.
--
-- La tabla es hermana de `catalog.movement_media` y por las mismas razones: la fila
-- apunta al objeto y no lo guarda, guarda una clave y nunca una URL —el origen es
-- configuración, así que mudarse de proveedor no reescribe una fila—, y el `checksum`
-- dice qué bytes revisó alguien. La visibilidad se hereda del programa en vez de
-- repetirse, igual que las demostraciones heredan la del movimiento, y `allfit_api`
-- recibe `select` y nada más: es contenido curado, y una portada escrita desde el
-- producto sería cambiar la cara del catálogo sin que nadie la revisara.
--
-- **Se siembra con lo que la columna ya tenía, como juego `male`**, para que la base no
-- se quede sin una sola portada entre esta migración y la recarga de la curación. **El
-- juego `female` llega con la curación**, junto con las medidas y los checksums de las
-- veinticuatro nuevas: aquí sólo se conoce la dirección, que es lo único que la columna
-- guardaba, y por eso las demás columnas admiten nulo. Hasta esa recarga, quien declaró
-- mujer ve lo mismo que veía ayer.
--
-- **`cover_for` sólo contesta por quien pregunta.** `allfit_api` puede ejecutarla, y sin
-- esa condición preguntar por la portada de otra persona diría cuál es su sexo
-- declarado, que es un dato sensible y no algo que se deduzca de una imagen.
--
-- Lo que no cambia: la clave sigue siendo el contenido y sigue siendo una clave y no una
-- URL, la portada sigue colgando del programa y no de la versión, y la respuesta sigue
-- siendo una sola dirección por programa — `cover_url` no se entera de nada de esto.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Las fotografías de portada de un programa curado, una por audiencia. Hermana de
-- `catalog.movement_media`, y la visibilidad se hereda del programa en vez de repetirse.
create table planning.program_cover_photos (
  program_id uuid not null,
  audience identity.biological_sex not null,
  object_key text not null,
  content_type text,
  width integer,
  height integer,
  byte_size integer,
  checksum text,
  constraint pk_program_cover_photos primary key (program_id, audience),
  constraint fk_program_cover_photos_program foreign key (program_id) references planning.programs (id) on delete cascade,
  -- Una clave, no una URL. El esquema sería el origen filtrándose dentro del dato.
  constraint ck_program_cover_photos_object_key check (
    btrim(object_key) <> '' and object_key like 'programs/%' and object_key !~ '^[a-z][a-z0-9+.-]*://'
  ),
  constraint ck_program_cover_photos_content_type check (content_type ~ '^image/[a-z0-9.+-]+$'),
  constraint ck_program_cover_photos_dimensions check (width > 0 and height > 0),
  constraint ck_program_cover_photos_byte_size check (byte_size > 0),
  constraint ck_program_cover_photos_checksum check (btrim(checksum) <> '')
);

alter table planning.program_cover_photos enable row level security;
alter table planning.program_cover_photos force row level security;

create policy program_cover_photos_select_actor on planning.program_cover_photos
  for select
  using (exists (select 1 from planning.programs as program where program.id = program_id));

alter table planning.program_cover_photos owner to allfit_owner;

grant select on planning.program_cover_photos to allfit_api;

-- Lo que la columna ya tenía, como juego `male`. **El juego `female` llega con la
-- curación**, con las medidas y los checksums que aquí no se conocen.
insert into planning.program_cover_photos (program_id, audience, object_key)
select program.id, 'male', program.cover_object_key
from planning.programs as program
where program.content_scope = 'global' and program.cover_object_key is not null;

-- De quién toma prestada la cara un programa que no tiene fotografías propias. Nulo en
-- los del catálogo, que tienen las suyas.
alter table planning.programs
  add column cover_from_program_id uuid,
  add constraint fk_programs_cover_from_program foreign key (cover_from_program_id) references planning.programs (id) on delete restrict,
  add constraint ck_programs_cover_from_program check (cover_from_program_id is distinct from id);

-- Lo ya prestado, traducido de la clave al prestamista. La clave era del catálogo, así
-- que el programa que la tenía es quien la prestó.
update planning.programs as borrower
set cover_from_program_id = lender.id
from planning.programs as lender
where borrower.content_scope <> 'global'
  and borrower.cover_object_key is not null
  and lender.content_scope = 'global'
  and lender.cover_object_key = borrower.cover_object_key;

-- Qué portada le toca a esta persona en este programa. Con la negativa elige el
-- identificador del programa, siempre igual: mezclado, y releído idéntico.
create or replace function planning.cover_for(p_program_id uuid, p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select photo.object_key
  from planning.programs as program
  join planning.program_cover_photos as photo
    on photo.program_id = coalesce(program.cover_from_program_id, program.id)
  where program.id = p_program_id
    -- Sólo por quien pregunta: la portada de otra persona diría su sexo declarado.
    and access_control.person() = p_person_id
    and photo.audience = coalesce(
      (select who.biological_sex from identity.people as who where who.id = p_person_id),
      case when get_byte(extensions.digest(p_program_id::text, 'sha256'), 0) % 2 = 0
        then 'male' else 'female' end::identity.biological_sex)
$function$;

alter function planning.cover_for(uuid, uuid) owner to allfit_owner;
revoke all on function planning.cover_for(uuid, uuid) from public;
grant execute on function planning.cover_for(uuid, uuid) to allfit_api;

-- Devuelve el prestamista y ya no la clave: con dos juegos, la clave depende de quién
-- mire y esto se decide al publicar, cuando todavía no hay nadie mirando.
drop function planning.pick_program_cover(uuid);

create or replace function planning.pick_program_cover(p_program_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select candidate.id
  from (
    select source.id,
           planning.program_region(source.id) = planning.program_region(p_program_id) as misma_region
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
      and exists (select 1 from planning.program_cover_photos as photo
                  where photo.program_id = source.id)
  ) as candidate
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador del programa, para que dos programas parecidos no salgan clonados.
  order by candidate.misma_region desc nulls last,
           extensions.digest(p_program_id::text || candidate.id::text, 'sha256')
  limit 1
$function$;

alter function planning.pick_program_cover(uuid) owner to allfit_owner;
revoke all on function planning.pick_program_cover(uuid) from public;
grant execute on function planning.pick_program_cover(uuid) to allfit_api;

-- La rutina recibe la persona: elegir el programa que le presta la cara no basta cuando
-- ese programa tiene dos, y la que le toca es la del juego de quien pregunta.
drop function planning.pick_routine_cover(uuid, text);

create or replace function planning.pick_routine_cover(p_template_id uuid, p_region text, p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select candidate.cover
  from (
    select source.id,
           planning.cover_for(source.id, p_person_id) as cover,
           planning.program_region(source.id) = p_region as misma_region
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
  ) as candidate
  -- Candidata es la que tiene fotografía **para quien pregunta**: prestar una que su
  -- juego no tiene sería dejar a la rutina sin cara teniendo el catálogo entero.
  where p_region is not null and candidate.cover is not null
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador de la plantilla, para que dos rutinas parecidas no salgan clonadas.
  order by candidate.misma_region desc nulls last,
           extensions.digest(p_template_id::text || candidate.id::text, 'sha256')
  limit 1
$function$;

alter function planning.pick_routine_cover(uuid, text, uuid) owner to allfit_owner;
revoke all on function planning.pick_routine_cover(uuid, text, uuid) from public;
grant execute on function planning.pick_routine_cover(uuid, text, uuid) to allfit_api;

-- La portada que responde es la de quien pregunta, y nada más cambia.
CREATE OR REPLACE FUNCTION planning.read_my_programs(p_person_id uuid)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_id uuid, title text, weeks integer, days_per_week integer, starts_on date, sessions_done integer, sessions_planned integer, editable boolean, cover_object_key text, routine_cover jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select assignment.id,
         version.id,
         version.program_id,
         version.title,
         case when version.repeats_forever then null else composition.cycle end,
         composition.days_per_week,
         assignment.starts_on,
         counted.done,
         counted.planned,
         -- A draft exists only for a programme somebody wrote here. A fork has none,
         -- and a programme whose weeks differ cannot be said as one repeated week.
         draft.id is not null
           and composition.cycle * composition.days_per_week = composition.sessions,
         -- La misma respuesta de siempre —una dirección por programa, con el nombre
         -- de la columna intacto— sólo que del juego de quien pregunta.
         planning.cover_for(program.id, p_person_id),
         -- El estilo que llevan sus rutinas, que es una decisión del programa y no de
         -- cada una: seis tarjetas con seis lenguajes distintos en el mismo carrusel.
         case when program.routine_cover_kind is null then null else jsonb_strip_nulls(
           jsonb_build_object('kind', program.routine_cover_kind, 'icon', program.routine_cover_icon)
         ) end
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.programs as program on program.id = version.program_id
  left join planning.program_drafts as draft on draft.program_id = version.program_id
  join lateral (
    select max(session.week) as cycle,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  join lateral (
    select count(*) filter (where session.status = 'completed')::integer as done,
           count(*)::integer as planned
    from planning.planned_sessions as session
    where session.assignment_id = assignment.id
  ) as counted on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
$function$;

alter function planning.read_my_programs(uuid) owner to allfit_owner;
revoke all on function planning.read_my_programs(uuid) from public;
grant execute on function planning.read_my_programs(uuid) to allfit_api;

-- Y la de la rutina también: dentro de «foto», la que le toca a esta persona.
CREATE OR REPLACE FUNCTION planning.read_my_content(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(item order by sort_key desc), '[]'::jsonb)
  from (
    select
      coalesce(published.published_at, draft.updated_at, template.created_at) as sort_key,
      jsonb_build_object(
        'template_id', template.id,
        'title', coalesce(draft.content->>'title', published.title, 'Sin nombre'),
        'discipline_code', template.discipline_code,
        'status', template.status,
        'template_version_id', published.id,
        -- **La portada la pone el programa, no la rutina.** Si cada rutina eligiera la
        -- suya, el carrusel de Hoy mezclaría figuras, iconos y fotografías en la misma
        -- fila. Una rutina suelta no lleva ninguna y se reconoce por su letra, que es
        -- como se reconocía antes de que esto existiera.
        'cover', dressed.cover,
        -- El estilo es del programa y la imagen es de la rutina: dentro de «foto», cada
        -- una recibe la del catálogo que corresponde a lo que ella trabaja, o seis
        -- tarjetas saldrían clonadas y sólo el rótulo las distinguiría.
        --
        -- **Se responde mire lo que mire el programa.** La hoja de portada enseña la
        -- previa de las tres clases antes de elegir ninguna; contestar sólo cuando ya
        -- está elegida dejaba esa pestaña con un azulejo vacío justo en el momento de
        -- decidir, que es lo que hacía pensar que el selector no hacía nada.
        'cover_object_key', planning.pick_routine_cover(template.id, worked.region, p_person_id),
        'muscles', worked.codes,
        -- Cuánto le toca a cada músculo. La tarjeta de Hoy lo dibuja bajo la figura, y
        -- el cliente no puede calcularlo: sabe cuántas series tiene la rutina en total,
        -- no cómo se reparten.
        'muscle_sets', effort.list,
        'versions', published_ones.list,
        'programs', belongs.list,
        'exercise_count', coalesce(published.exercise_count, 0),
        'set_count', coalesce(published.set_count, 0),
        'has_unpublished_changes',
          draft.id is not null
          and (
            published.content_hash is null
            or extensions.digest(
                 convert_to(planning.canonical_session_content(draft.content)::text, 'UTF8'),
                 'sha256'
               ) is distinct from published.content_hash
          )
      ) as item
    from planning.session_templates as template
    left join planning.session_template_drafts as draft on draft.template_id = template.id
    left join lateral (
      select
        version.id,
        version.published_at,
        version.title,
        version.content_hash,
        (select count(*) from planning.planned_steps as step
          where step.template_version_id = version.id) as exercise_count,
        (select coalesce(sum(target.target_sets), 0)
          from planning.planned_steps as step
          join planning.strength_targets as target on target.planned_step_id = step.id
          where step.template_version_id = version.id) as set_count
      from planning.session_template_versions as version
      where version.template_id = template.id
        and version.status = 'published'
      order by version.version_number desc
      limit 1
    ) as published on true
    left join lateral (
      select coalesce(jsonb_agg(grouped.code order by grouped.trains_it desc, grouped.ord), '[]'::jsonb) as codes,
             -- La región que más pesa, para la fotografía. Del mismo recorrido que los
             -- códigos: recorrerlo dos veces sería contar lo mismo dos veces.
             (array_agg(grouped.region order by grouped.weight desc, grouped.ord))[1] as region
      from (
        select muscle.code,
               min(muscle.region) as region,
               count(*) filter (where link.is_primary) as weight,
               bool_or(link.is_primary) as trains_it,
               min(muscle.display_order) as ord
        from (
          select distinct nullif(step.value->>'movement_id', '')::uuid as movement_id
          from jsonb_array_elements(
                 case when draft.id is not null and jsonb_typeof(draft.content->'steps') = 'array'
                   then draft.content->'steps' else '[]'::jsonb end
               ) as step(value)
          union
          select distinct step.movement_id
          from planning.planned_steps as step
          where draft.id is null and step.template_version_id = published.id
        ) as held
        join catalog.movement_muscles as link on link.movement_id = held.movement_id
        join catalog.muscles as muscle on muscle.id = link.muscle_id
        where held.movement_id is not null and muscle.status = 'published'
        group by muscle.code
      ) as grouped
    ) as worked on true
    -- Las series que carga cada músculo.
    --
    -- **Una serie se le cuenta a un solo músculo**, el primario del ejercicio. Repartir
    -- cada serie entre todos los que el movimiento toca convierte trece series en
    -- treinta y una, y el número deja de ser el trabajo hecho para pasar a ser un
    -- recuento de menciones.
    left join lateral (
      select coalesce(jsonb_agg(
               jsonb_build_object('code', per.code, 'name', per.name, 'sets', per.sets)
               order by per.sets desc, per.name
             ), '[]'::jsonb) as list
      from (
        select loading.code, loading.name, sum(held.sets)::integer as sets
        from (
          select nullif(step.value->>'movement_id', '')::uuid as movement_id,
                 coalesce(
                   (step.value->'target'->>'target_sets')::integer,
                   jsonb_array_length(coalesce(step.value->'target'->'sets', '[]'::jsonb)),
                   0
                 ) as sets
          from jsonb_array_elements(
                 case when draft.id is not null and jsonb_typeof(draft.content->'steps') = 'array'
                   then draft.content->'steps' else '[]'::jsonb end
               ) as step(value)
          union all
          select step.movement_id, coalesce(target.target_sets, 0)
          from planning.planned_steps as step
          left join planning.strength_targets as target on target.planned_step_id = step.id
          where draft.id is null and step.template_version_id = published.id
        ) as held
        -- Uno y sólo uno por ejercicio: el primario, y el de menor orden cuando hay más
        -- de uno. Es la misma regla que el cliente usaba, movida a donde están los datos.
        join lateral (
          select muscle.code, muscle.name
          from catalog.movement_muscles as link
          join catalog.muscles as muscle on muscle.id = link.muscle_id
          where link.movement_id = held.movement_id and muscle.status = 'published'
          order by link.is_primary desc, muscle.display_order
          limit 1
        ) as loading on true
        where held.movement_id is not null and held.sets > 0
        group by loading.code, loading.name
      ) as per
    ) as effort on true
    -- En qué programas de la persona está esta rutina.
    --
    -- Contra **cualquier** versión de la plantilla y no sólo la última: un programa
    -- congela la versión que eligió, así que publicar una rutina otra vez no la saca
    -- del programa que la usa, y mirar sólo la última diría que no está en ninguno.
    -- Todas sus versiones publicadas, de la más nueva a la más vieja.
    --
    -- La semana de un programa guarda la versión exacta que compuso, y republicar la
    -- rutina acuña otra. Una pantalla que sólo mire la última pierde la rutina de una
    -- semana en la que está: eso es lo que hacía desaparecer del editor una rutina
    -- recién editada. Con la lista, el día puede decir qué tiene sin resolver «la
    -- última», que es lo que `ADR-009` prohíbe para cualquier cosa histórica.
    left join lateral (
      select coalesce(jsonb_agg(version.id order by version.version_number desc), '[]'::jsonb) as list
      from planning.session_template_versions as version
      where version.template_id = template.id and version.status = 'published'
    ) as published_ones on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('program_id', used.program_id, 'title', used.title)), '[]'::jsonb) as list
      from (
        select distinct program.id as program_id, version.title
        from planning.program_assignments as assignment
        join planning.program_versions as version on version.id = assignment.program_version_id
        join planning.programs as program on program.id = version.program_id
        join planning.program_version_sessions as composition
          on composition.program_version_id = version.id
        join planning.session_template_versions as used_version
          on used_version.id = composition.template_version_id
         and used_version.template_id = template.id
        where assignment.person_id = p_person_id
          and assignment.lifecycle = 'personal'
      ) as used
    ) as belongs on true
    -- De cuál de sus programas se viste. El primero por el orden que la persona ya
    -- eligió, que es el mismo con el que abre la pestaña: una rutina en dos programas
    -- tiene que salir de una manera y no de dos según quién pregunte.
    left join lateral (
      select case when program.routine_cover_kind is null then null else jsonb_strip_nulls(
               jsonb_build_object('kind', program.routine_cover_kind,
                                  'icon', program.routine_cover_icon)
             ) end as cover
      from planning.program_assignments as assignment
      join planning.program_versions as version on version.id = assignment.program_version_id
      join planning.programs as program on program.id = version.program_id
      join planning.program_version_sessions as composition
        on composition.program_version_id = version.id
      join planning.session_template_versions as used_version
        on used_version.id = composition.template_version_id
       and used_version.template_id = template.id
      where assignment.person_id = p_person_id
        and assignment.lifecycle = 'personal'
        and program.routine_cover_kind is not null
      order by assignment.display_order, assignment.assigned_at desc
      limit 1
    ) as dressed on true
    where template.owner_person_id = p_person_id
      and template.status <> 'archived'
  ) as mine
$function$;

alter function planning.read_my_content(uuid) owner to allfit_owner;
revoke all on function planning.read_my_content(uuid) from public;
grant execute on function planning.read_my_content(uuid) to allfit_api;

-- La portada propia deja de guardarse como clave y se guarda como préstamo.
CREATE OR REPLACE FUNCTION planning.publish_program_content(p_program_id uuid, p_content jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  session jsonb;
begin
  perform planning.lock_program_template_versions(p_content, null);
  errors := planning.program_content_errors(p_content, null, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete program draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_program_content(p_content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  -- Sólo la última, por la misma razón que en las plantillas: el identificador de
  -- versión viaja en asignaciones y sesiones planificadas.
  select latest.id into version_id
  from (
    select existing.id, existing.content_hash, existing.status
    from planning.program_versions as existing
    where existing.program_id = p_program_id
    order by existing.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.program_versions as existing where existing.program_id = p_program_id;
    insert into planning.program_versions (
      program_id, version_number, title, notes, content_hash, repeats_forever
    ) values (
      p_program_id, next_version, canonical_content->>'title',
      canonical_content->>'notes', version_content_hash,
      (canonical_content->>'repeats_forever')::boolean
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for session in
      select value from jsonb_array_elements(canonical_content->'sessions')
      order by (value->>'position')::integer
    loop
      insert into planning.program_version_sessions (
        program_version_id, template_version_id, position, week, day
      ) values (
        version_id, (session->>'template_version_id')::uuid,
        (session->>'position')::integer, (session->>'week')::integer,
        (session->>'day')::integer
      );
    end loop;
    update planning.programs
    set status = 'published', updated_at = clock_timestamp() where id = p_program_id;
    perform system.enqueue_outbox_event(
      'program_version', version_id, 'planning.program_version_published.v1',
      jsonb_build_object('program_id', p_program_id, 'version_id', version_id,
                         'version_number', next_version)
    );
  end if;
  -- De quién la toma prestada, si todavía no lo tiene. Aquí y no al leer: una elección
  -- que cambiara al añadir un ejercicio sería una tarjeta distinta cada vez.
  -- Sólo lo que no es del catálogo: un global tiene fotografías propias, y prestarle
  -- las de otro sería taparlas antes de que la curación las escriba.
  update planning.programs
  set cover_from_program_id = planning.pick_program_cover(p_program_id)
  where id = p_program_id and content_scope <> 'global' and cover_from_program_id is null;
  return version_id;
end
$function$;

alter function planning.publish_program_content(uuid, jsonb) owner to allfit_owner;
revoke all on function planning.publish_program_content(uuid, jsonb) from public, allfit_api;

-- La copia se lleva la cara del original apuntando a él, y así conserva sus dos juegos.
CREATE OR REPLACE FUNCTION planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  source record;
  new_program_id uuid;
  new_version_id uuid;
  mapping jsonb := '{}'::jsonb;
  template record;
  new_template_id uuid;
  new_template_version_id uuid;
  step record;
  new_step_id uuid;
begin
  select version.id, version.title, version.notes, version.content_hash,
         version.sex_affinity, version.repeats_forever
  into source
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id
    and version.status = 'published'
    and program.content_scope = 'global'
    and program.status = 'published';
  if source.id is null then
    raise exception 'program version is not forkable' using errcode = '42501';
  end if;

  perform set_config('app.planning_publication', 'true', true);

  -- One copy per distinct template the program composes, remembered so the new
  -- composition points at the person's own versions and never at Allfit's.
  for template in
    select distinct source_version.id as version_id,
           -- El contenido que la copia va a tener, calculado una vez: fija su hash y es
           -- su borrador. La portada viaja entera, incluida la fotografía: desde que sale
           -- del catálogo y no de la galería de nadie, copiarla no es quedarse con algo
           -- ajeno.
           planning.canonical_session_content(
             planning.session_version_projection(source_version.id)) as content,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.content_hash,
           source_template.discipline_code as template_discipline
    from planning.program_version_sessions as composition
    join planning.session_template_versions as source_version
      on source_version.id = composition.template_version_id
    join planning.session_templates as source_template
      on source_template.id = source_version.template_id
    where composition.program_version_id = p_program_version_id
  loop
    insert into planning.session_templates (
      content_scope, owner_person_id, author_person_id, discipline_code, status
    ) values ('person', p_person_id, p_person_id, template.template_discipline, 'published')
    returning id into new_template_id;

    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id, title,
      derived_from_version_id, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
      -- **El hash de su propio contenido, no el del original.** Copiar el del origen
      -- era copiar la descripción de otra cosa.
      extensions.digest(
        convert_to(planning.canonical_session_content(template.content)::text, 'UTF8'),
        'sha256'
      ),
      'published', clock_timestamp()
    ) returning id into new_template_version_id;

    for step in
      select id, position, movement_id, activity_type_id, notes, superset_group
      from planning.planned_steps
      where template_version_id = template.version_id
      order by position
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        new_template_version_id, step.position, step.movement_id, step.activity_type_id,
        step.notes, step.superset_group
      ) returning id into new_step_id;

      -- The sets come first: `IX-47` compares the summary against them, and the
      -- constraint is deferred so the order inside the transaction does not matter,
      -- but a fork that copied only the summary would flatten the routine.
      insert into planning.planned_sets (
        planned_step_id, set_order, kind, target_reps,
        target_load_value, target_load_unit_code, target_rpe
      )
      select new_step_id, set_order, kind, target_reps,
             target_load_value, target_load_unit_code, target_rpe
      from planning.planned_sets where planned_step_id = step.id;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      )
      select new_step_id, target_sets, target_reps, target_load_value,
             target_load_unit_code, target_rpe, target_rest_seconds
      from planning.strength_targets where planned_step_id = step.id;

      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      )
      select new_step_id, target_distance_value, target_distance_unit_code,
             target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      from planning.endurance_targets where planned_step_id = step.id;

      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      )
      select new_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      from planning.interval_targets where planned_step_id = step.id;

      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      )
      select new_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      from planning.mobility_targets where planned_step_id = step.id;
    end loop;

    -- **Y su borrador.** Tomar es quedárselo, y una rutina que no se puede abrir para
    -- editar no es del todo tuya.
    insert into planning.session_template_drafts (template_id, content, derived_from_version_id)
    values (new_template_id, template.content, new_template_version_id);

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  -- La copia se lleva la cara del original **y el estilo de sus rutinas**: tomar un
  -- programa de Allfit y que sus seis tarjetas cambiaran de aspecto sería tomar otro.
  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status, cover_from_program_id,
    routine_cover_kind, routine_cover_icon
  )
  select 'person', p_person_id, p_person_id, 'published',
         -- Apunta al original en vez de copiar su clave: así la copia tiene los dos
         -- juegos que tenía, y no la fotografía de la audiencia de quien la tomó.
         coalesce(origin.cover_from_program_id, origin.id),
         origin.routine_cover_kind, origin.routine_cover_icon
  from planning.programs as origin
  join planning.program_versions as taken on taken.program_id = origin.id
  where taken.id = p_program_version_id
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at,
    sex_affinity, repeats_forever
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity, source.repeats_forever
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  -- **Y su borrador.** Sin él, un programa tomado de Allfit no se puede abrir para
  -- editar: `read_my_programs` marca `editable` cuando hay borrador, y la tarjeta se
  -- quedaba sin el botón.
  --
  -- La composición se reconstruye de la copia recién hecha, que es donde las sesiones ya
  -- apuntan a las plantillas de la persona. **Y lleva `repeats_forever`**, o el primer
  -- guardado del borrador le devolvería una fecha de fin que el original no tenía.
  insert into planning.program_drafts (program_id, content)
  select new_program_id, planning.canonical_program_content(jsonb_build_object(
    'title', source.title,
    'notes', source.notes,
    'repeats_forever', source.repeats_forever,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', composition.position,
        'week', composition.week,
        'day', composition.day,
        'template_version_id', composition.template_version_id
      ) order by composition.position)
      from planning.program_version_sessions as composition
      where composition.program_version_id = new_version_id
    ), '[]'::jsonb)
  ));

  -- The segmentation travels with the copy: it is what the catalogue matched on,
  -- and a copy that forgot it would stop being findable as the thing it is.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select new_version_id, goal_code from planning.program_version_goals
  where program_version_id = p_program_version_id;
  insert into planning.program_version_levels (program_version_id, experience_code)
  select new_version_id, experience_code from planning.program_version_levels
  where program_version_id = p_program_version_id;
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select new_version_id, focus_area_code from planning.program_version_emphases
  where program_version_id = p_program_version_id;

  return new_version_id;
end
$function$;

alter function planning.fork_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.fork_program_version(uuid, uuid) from public, allfit_api;

-- Y la columna se va, cuando ya no la lee nadie.
alter table planning.programs drop column cover_object_key;

commit;
