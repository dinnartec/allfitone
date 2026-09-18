-- Descartar una rutina se lleva sus fotos — `ADR-031`, `HU-SP-109` criterio 6.
--
-- `OP-PLN-028` archiva y no borra: la plantilla sigue existiendo, así que el borrado en
-- cascada de sus binarios nunca ocurre. Los bytes de una persona sobrevivían a la rutina
-- que los justificaba, que es justo lo que `ADR-031` promete que no pasa.
--
-- El descarte ya rechaza una plantilla con versión publicada, así que aquí no hay ninguna
-- foto que una versión inmutable esté obligada a conservar: se destruyen todas.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function planning.discard_my_session_template(
  p_person_id uuid,
  p_template_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (template jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.session_templates%rowtype;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-028', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into current
  from planning.session_templates as template
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  -- A routine with a published version is referenced by programmes and assignments.
  -- Retiring it from new uses is `OP-PLN-005`, which leaves the history alone.
  if exists (
    select 1 from planning.session_template_versions as version
    where version.template_id = p_template_id
  ) then
    raise exception 'template has published versions' using errcode = '23514';
  end if;

  if current.status <> 'archived' then
    update planning.session_templates
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_template_id;

    -- Descartar se lleva las fotos. Archivar no borra la plantilla, así que el cascade
    -- nunca dispara: sin esto, los bytes de alguien sobrevivirían a la rutina que los
    -- justificaba, que es exactamente lo que `ADR-031` promete que no pasa. Ninguna
    -- versión publicada puede referenciarlas porque el descarte las rechaza arriba.
    perform set_config('app.disposition_reason', 'content_discarded', true);
    delete from planning.session_template_cover_photos where template_id = p_template_id;
    perform set_config('app.disposition_reason', '', true);
    perform system.enqueue_outbox_event(
      'session_template', p_template_id, 'planning.session_template_discarded.v1',
      jsonb_build_object('template_id', p_template_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-discarded',
    'session_template', p_template_id
  );
  return query select planning.session_template_projection(p_template_id), false;
end
$function$;

commit;
