-- Resolve the Studio account and person through the existing RLS policies in one statement.

set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function identity.resolve_actor_registration(p_account_id uuid)
returns table (person_id uuid, person_status text)
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  v_person_id uuid;
  v_person_status text;
begin
  perform pg_catalog.set_config('app.actor_kind', 'account', true);
  perform pg_catalog.set_config('app.actor_account_id', p_account_id::text, true);
  perform pg_catalog.set_config('app.actor_person_id', '', true);

  select account.person_id
  into v_person_id
  from identity.access_accounts as account
  where account.id = p_account_id;

  if not found then
    return;
  end if;

  if v_person_id is null then
    return query select null::uuid, null::text;
    return;
  end if;

  perform pg_catalog.set_config('app.actor_kind', 'person', true);
  perform pg_catalog.set_config('app.actor_person_id', v_person_id::text, true);

  select person.status::text
  into v_person_status
  from identity.people as person
  where person.id = v_person_id;

  return query select v_person_id, v_person_status;
end
$function$;

alter function identity.resolve_actor_registration(uuid) owner to allfit_owner;
revoke all on function identity.resolve_actor_registration(uuid) from public;
grant execute on function identity.resolve_actor_registration(uuid) to allfit_api;
