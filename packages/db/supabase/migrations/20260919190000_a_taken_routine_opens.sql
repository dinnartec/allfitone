-- Una rutina tomada también se puede abrir — `OP-PLN-011`, `OP-PLN-023`.
--
-- `OP-PLN-011` dice que **tomar un programa global es quedárselo**: la bifurcación copia
-- el programa, sus plantillas, sus pasos y sus targets, y la persona pasa a ser dueña de
-- todo. Pero no copiaba el borrador, que es lo único por lo que una rutina se abre para
-- editar. El resultado era una rutina tuya, en tu biblioteca, que al tocarla respondía
-- que no existe: la pantalla decía «no pudimos cargar tu rutina» cuando no había fallado
-- nada y no había nada que cargar.
--
-- El contenido se reconstruye de la copia con `session_version_projection`, que ya
-- renderiza título, tipo de actividad, portada, pasos, targets y series, y se pasa por
-- `canonical_session_content`. **Si ese render no fuese fiel, la rutina aparecería con
-- cambios sin publicar en el instante de tomarla**, porque el hash del borrador dejaría
-- de coincidir con el de su versión. Esa es la aserción que lo prueba.
--
-- De la copia y no del original a propósito: una portada de foto no se bifurca, así que
-- las dos versiones no dicen lo mismo y el borrador tiene que describir la que existe.
--
-- **Y el hash de la copia pasa a ser el de su propio contenido.** Antes se copiaba el
-- del original, que describe otra cosa: publicar expande `target_sets` en series
-- explícitas, así que el contenido re-renderizado canonicaliza distinto del compacto que
-- escribió la curación —21 de las 40 versiones globales no reproducen su propio hash— y
-- la copia nacía anunciando cambios que nadie hizo.
--
-- Lo ya bifurcado se rellena igual, que si no seguiría sin poder abrirse.

begin;

set lock_timeout = '5s';

create or replace function planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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
  select version.id, version.title, version.notes, version.content_hash, version.sex_affinity
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
           -- su borrador. Sin la portada cuando es una foto, que no se bifurca.
           case when source_version.cover_kind = 'photo'
             then planning.canonical_session_content(
                    planning.session_version_projection(source_version.id) - 'cover')
             else planning.canonical_session_content(
                    planning.session_version_projection(source_version.id))
           end as content,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.cover_kind,
           source_version.cover_icon,
           source_version.cover_photo_id,
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
      derived_from_version_id, cover_kind, cover_icon, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
      -- Una portada de foto no se copia: los bytes son de quien los subió y la clave
      -- foránea compuesta ata la foto a su plantilla. La copia se queda sin portada,
      -- que es un estado legítimo, en vez de con una que no le pertenece.
      case when template.cover_kind = 'photo' then null else template.cover_kind end,
      template.cover_icon,
      -- **El hash de su propio contenido, no el del original.** Copiar el del origen
      -- era copiar la descripción de otra cosa: publicar expande `target_sets` en series
      -- explícitas, así que el contenido re-renderizado canonicaliza distinto del
      -- compacto que escribió la curación, y la copia nacía diciendo que tenía cambios
      -- sin publicar sin que nadie la hubiera tocado.
      -- Con la **misma expresión** con la que se compara después. `read_my_content`
      -- pregunta si `digest(canonical(borrador))` coincide con este hash, y resulta que
      -- `canonical_session_content` no es idempotente: aplicarla dos veces da otros
      -- bytes. Guardar el contenido ya canonicalizado sin volver a pasarlo dejaba la
      -- copia anunciando cambios que nadie hizo, que es justo lo que esto viene a quitar.
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
    -- editar no es del todo tuya: sin esta fila, abrirla respondía que no existe y la
    -- pantalla decía «no pudimos cargar», que además de inútil era falso.
    --
    -- Se arma de la copia recién hecha y no del original, porque las dos no son iguales:
    -- una portada de foto no se copia. Y pasa por el canonicalizador, así que su hash es
    -- el de la versión — la rutina nace sin cambios pendientes, que es la verdad.
    insert into planning.session_template_drafts (template_id, content, derived_from_version_id)
    values (new_template_id, template.content, new_template_version_id);

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status, cover_object_key
  )
  select 'person', p_person_id, p_person_id, 'published', origin.cover_object_key
  from planning.programs as origin
  join planning.program_versions as taken on taken.program_id = origin.id
  where taken.id = p_program_version_id
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at, sex_affinity
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

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


-- Las que ya se tomaron antes de esto reciben su borrador. Con el contexto de su dueño
-- puesto, porque las funciones que esto llama corren bajo las políticas del dueño de las
-- tablas y sin actor el bucle se ejecutaría entero sin escribir una fila.
--
-- **Su hash se queda como está.** Describe el contenido del original y no el suyo, así
-- que esas rutinas dirán «con cambios sin publicar» hasta que alguien las publique una
-- vez — y entonces la versión nueva sí describirá lo que tiene dentro. Corregirlo a mano
-- sería reescribir una versión publicada, que es justamente lo que la base impide y hace
-- bien en impedir.
do $$
declare
  copia record;
  contenido jsonb;
begin
  for copia in
    select template.id, template.owner_person_id,
           (select version.id from planning.session_template_versions as version
            where version.template_id = template.id and version.status = 'published'
            order by version.version_number desc limit 1) as version_id,
           exists (select 1 from planning.session_template_drafts as draft
                   where draft.template_id = template.id) as tiene_borrador
    from planning.session_templates as template
    where template.content_scope = 'person'
      and template.status <> 'archived'
      and template.owner_person_id is not null
  loop
    continue when copia.version_id is null;
    perform set_config('app.actor_kind', 'person', true);
    perform set_config('app.actor_person_id', copia.owner_person_id::text, true);

    contenido := planning.canonical_session_content(
      planning.session_version_projection(copia.version_id));
    continue when contenido is null;

    if not copia.tiene_borrador then
      insert into planning.session_template_drafts (template_id, content, derived_from_version_id)
      values (copia.id, contenido, copia.version_id);
    end if;

  end loop;
  perform set_config('app.actor_person_id', '', true);
  perform set_config('app.actor_kind', '', true);
end $$;

commit;
