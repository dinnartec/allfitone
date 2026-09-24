-- `support.person_metadata` records its read under the mode that names it.
--
-- Separate from the migration that adds `support_metadata` to
-- `privacy.access_mode`, because a new enum value cannot be used in the
-- transaction that adds it.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function support.person_metadata(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  found jsonb;
begin
  perform support.require_support_diagnostician(p_actor_person_id, p_actor_session_id);

  if btrim(coalesce(p_case_reference, '')) !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'a support read needs a traceable case reference' using errcode = '22023';
  end if;

  select to_jsonb(metadata) into found
  from support.v_support_metadata as metadata
  where metadata.person_id = p_person_id;

  if found is null then
    raise exception 'person not found in the support projection' using errcode = 'P0002';
  end if;

  -- The read is recorded against the person before the content is returned. The
  -- ritual is the same as everywhere else: if the record fails, the read fails.
  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode
  ) values (
    p_actor_person_id,
    p_person_id,
    'support.v_support_metadata',
    p_person_id,
    'support_diagnosis',
    'allowed',
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'support_metadata'::privacy.access_mode
  );

  return found;
end
$function$;

alter function support.person_metadata(uuid, uuid, text, uuid) owner to allfit_owner;
revoke all on function support.person_metadata(uuid, uuid, text, uuid) from public;
grant execute on function support.person_metadata(uuid, uuid, text, uuid) to allfit_api;
