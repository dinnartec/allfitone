-- OP-PRV-023 — Ver qué nos autorizó cada persona.
--
-- HU-STUDIO-035. La ficha de un vínculo ya dice qué autorizó una persona; esto
-- lo dice de todas a la vez, que es lo que un coach necesita para saber con qué
-- puede contar antes de abrir a nadie.
--
-- **Por qué el filtro sale del vínculo y no del permiso.** La política de
-- `privacy.data_grants` estrecha a la organización:
--
--   person_id = access_control.person() or organization_id = access_control.org()
--
-- Eso basta en la ficha, porque la proyección de permisos solo se alcanza
-- después de que el vínculo pasó su propia guarda. Aquí no: leer `data_grants`
-- sola le entregaría a un coach lo que autorizaron clientes que no atiende. La
-- política de `relationships.service_relationships` sí sabe de asignación
-- —`has_capability('view_directory') or actor_is_assigned(id)`—, así que la
-- unión obligatoria con el vínculo es lo que cumple el criterio 2. No es una
-- unión por conveniencia: es la guarda.
--
-- **Criterio 5**, que no se ve en ninguna columna: esto es un informe, nunca la
-- fuente que decide un acceso. Quien vaya a leer un dato de una persona
-- consulta la política en ese instante y dentro de la transacción que escribe
-- el registro de acceso; lo que esta función devuelve ya es pasado cuando el
-- lector lo tiene en pantalla. Cachearlo como atajo de autorización sería
-- exactamente lo que el criterio prohíbe.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function privacy.list_authorized_scopes(
  p_person_id uuid,
  p_organization_id uuid,
  p_limit integer,
  p_cursor_name text,
  p_cursor_id uuid
)
returns table (
  relationship_id uuid,
  person_id uuid,
  display_name text,
  grant_id uuid,
  scope_code text,
  scope_display_name text,
  version_number integer,
  access_level text,
  status text,
  purpose text,
  granted_at timestamptz,
  revoked_at timestamptz,
  sort_name text,
  sort_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_membership_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  if (p_cursor_name is null) <> (p_cursor_id is null) then
    raise exception 'invalid authorized scopes cursor' using errcode = '22023';
  end if;

  select membership.id into actor_membership_id
  from organizations.organizations as organization
  join organizations.organization_memberships as membership
    on membership.organization_id = organization.id
   and membership.person_id = p_person_id
   and membership.status = 'active'
  where organization.id = p_organization_id
    and organization.status = 'active';

  if actor_membership_id is null
     or not (
       access_control.has_capability(p_organization_id, 'view_directory')
       or access_control.has_capability(p_organization_id, 'view_assigned_directory')
     ) then
    raise exception 'reading authorized scopes requires a directory capability'
      using errcode = '42501';
  end if;

  /*
   * The row policy resolves the organization through `access_control.org()`,
   * which reads this setting and then checks the actor really holds a live
   * membership in it. Omitting it leaves the policy blind to the organization,
   * and a coach would silently read nothing.
   */
  perform set_config('app.actor_org_id', p_organization_id::text, true);

  return query
  select
    grant_row.relationship_id,
    grant_row.person_id,
    person.display_name,
    grant_row.id as grant_id,
    grant_row.scope_code,
    presentation.display_name as scope_display_name,
    definition.version_number,
    grant_row.access_level::text,
    grant_row.status::text,
    grant_row.purpose,
    grant_row.granted_at,
    grant_row.revoked_at,
    person.display_name as sort_name,
    grant_row.id as sort_id
  from privacy.data_grants as grant_row
  /*
   * The guard, not a convenience. Reading `data_grants` alone hands a coach the
   * authorizations of clients they do not attend — measured: three rows where
   * two were theirs. This join puts every row through the relationship's own
   * policy, which is the one that knows about assignment, and T-PRV-SCOPES-01
   * fails the day it is removed.
   */
  join relationships.service_relationships as relationship
    on relationship.id = grant_row.relationship_id
   and relationship.organization_id = grant_row.organization_id
   and relationship.person_id = grant_row.person_id
  join identity.people as person on person.id = grant_row.person_id
  join privacy.scope_definitions as definition
    on definition.id = grant_row.scope_definition_id
   and definition.scope_code = grant_row.scope_code
  left join privacy.scope_presentations as presentation
    on presentation.scope_code = grant_row.scope_code
  where grant_row.organization_id = p_organization_id
    and (
      p_cursor_name is null
      or (person.display_name, grant_row.id) > (p_cursor_name, p_cursor_id)
    )
  order by person.display_name, grant_row.id
  limit p_limit;
end
$function$;

alter function privacy.list_authorized_scopes(uuid, uuid, integer, text, uuid)
  owner to allfit_owner;
revoke all on function privacy.list_authorized_scopes(uuid, uuid, integer, text, uuid)
  from public;
grant execute on function privacy.list_authorized_scopes(uuid, uuid, integer, text, uuid)
  to allfit_api;
