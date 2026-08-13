-- HU-STUDIO-017/018: governed team directory and complete V1 role catalogue.

set lock_timeout = '5s';
set statement_timeout = '60s';

insert into organizations.organization_capabilities (code, name)
values
  ('manage_organization', 'Mantener los datos de la organización'),
  ('manage_sites', 'Administrar sedes'),
  ('manage_memberships', 'Administrar membresías del equipo'),
  ('manage_roles', 'Administrar roles'),
  ('invite_clients', 'Invitar clientes'),
  ('view_directory', 'Consultar directorios organizacionales sin datos fitness'),
  ('manage_relationships', 'Administrar relaciones de servicio'),
  ('assign_professionals', 'Asignar profesionales responsables'),
  ('terminate_relationships', 'Terminar relaciones de servicio'),
  ('manage_plans', 'Administrar planes comerciales'),
  ('manage_billing', 'Administrar cobros y suscripciones'),
  ('manage_historical_access', 'Administrar casos históricos sin conceder lectura'),
  ('connect_billing_account', 'Conectar la cuenta de cobro'),
  ('close_organization', 'Cerrar la organización'),
  ('view_assigned_directory', 'Consultar únicamente las personas asignadas'),
  ('manage_content', 'Crear y publicar contenido de entrenamiento'),
  ('assign_programs', 'Asignar programas'),
  ('exercise_grants', 'Ejercer grants solo con relación, asignación y grant vigentes'),
  ('observe_training', 'Observar ejecuciones autorizadas'),
  ('propose_corrections', 'Proponer correcciones de entrenamiento'),
  ('guide_nutrition', 'Orientar nutrición únicamente con credencial verificada')
on conflict (code) do update
set name = excluded.name;

insert into organizations.role_capabilities (role_code, capability_code)
values
  ('owner', 'manage_organization'),
  ('owner', 'manage_sites'),
  ('owner', 'manage_memberships'),
  ('owner', 'manage_roles'),
  ('owner', 'invite_clients'),
  ('owner', 'view_directory'),
  ('owner', 'manage_relationships'),
  ('owner', 'assign_professionals'),
  ('owner', 'terminate_relationships'),
  ('owner', 'manage_plans'),
  ('owner', 'manage_billing'),
  ('owner', 'manage_historical_access'),
  ('owner', 'connect_billing_account'),
  ('owner', 'close_organization'),
  ('admin', 'manage_organization'),
  ('admin', 'manage_sites'),
  ('admin', 'manage_memberships'),
  ('admin', 'manage_roles'),
  ('admin', 'invite_clients'),
  ('admin', 'view_directory'),
  ('admin', 'manage_relationships'),
  ('admin', 'assign_professionals'),
  ('admin', 'terminate_relationships'),
  ('admin', 'manage_plans'),
  ('admin', 'manage_billing'),
  ('admin', 'manage_historical_access'),
  ('coach', 'invite_clients'),
  ('coach', 'view_assigned_directory'),
  ('coach', 'manage_content'),
  ('coach', 'assign_programs'),
  ('coach', 'exercise_grants'),
  ('coach', 'observe_training'),
  ('coach', 'propose_corrections'),
  ('coach', 'guide_nutrition'),
  ('staff', 'invite_clients'),
  ('staff', 'view_directory')
on conflict (role_code, capability_code) do nothing;

create index idx_organization_memberships_team_listing
  on organizations.organization_memberships (organization_id, status, id);

create index idx_people_display_name_id
  on identity.people ((lower(display_name) collate "C"), id);

create or replace function organizations.list_organization_memberships(
  p_person_id uuid,
  p_organization_id uuid,
  p_status text,
  p_limit integer,
  p_cursor_status text,
  p_cursor_display_name text,
  p_cursor_membership_id uuid
)
returns table (
  membership_id uuid,
  display_name text,
  status text,
  joined_at timestamptz,
  ended_at timestamptz,
  roles text[],
  sort_display_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('active', 'terminated') then
    raise exception 'invalid membership status' using errcode = '22023';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  if (p_cursor_status is null) <> (p_cursor_display_name is null)
     or (p_cursor_status is null) <> (p_cursor_membership_id is null)
     or (p_cursor_status is not null and p_cursor_status not in ('active', 'terminated')) then
    raise exception 'invalid membership cursor' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from organizations.organizations as organization
    join organizations.organization_memberships as membership
      on membership.organization_id = organization.id
     and membership.person_id = p_person_id
     and membership.status = 'active'
    where organization.id = p_organization_id
      and organization.status = 'active'
      and (
        access_control.has_capability(p_organization_id, 'manage_memberships')
        or access_control.has_capability(p_organization_id, 'view_directory')
      )
  ) then
    raise exception 'organization membership is not available' using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    person.display_name,
    membership.status::text,
    membership.joined_at,
    membership.ended_at,
    coalesce((
      select array_agg(
        membership_role.role_code
        order by case membership_role.role_code
          when 'owner' then 1
          when 'admin' then 2
          when 'coach' then 3
          else 4
        end
      )
      from organizations.membership_roles as membership_role
      where membership_role.membership_id = membership.id
        and (
          (
            membership.status = 'active'
            and membership_role.valid_from <= statement_timestamp()
            and (
              membership_role.valid_to is null
              or membership_role.valid_to >= statement_timestamp()
            )
          )
          or (
            membership.status = 'terminated'
            and membership_role.valid_from <= membership.ended_at
            and (
              membership_role.valid_to is null
              or membership_role.valid_to >= membership.ended_at
            )
          )
        )
    ), array[]::text[]),
    lower(person.display_name)
  from organizations.organization_memberships as membership
  join identity.people as person on person.id = membership.person_id
  where membership.organization_id = p_organization_id
    and (p_status is null or membership.status::text = p_status)
    and (
      p_cursor_status is null
      or (
        case membership.status when 'active' then 0 else 1 end,
        lower(person.display_name) collate "C",
        membership.id
      ) > (
        case p_cursor_status when 'active' then 0 else 1 end,
        p_cursor_display_name collate "C",
        p_cursor_membership_id
      )
    )
  order by
    case membership.status when 'active' then 0 else 1 end,
    lower(person.display_name) collate "C",
    membership.id
  limit p_limit;
end
$function$;

create or replace function organizations.list_organization_roles(
  p_person_id uuid,
  p_organization_id uuid
)
returns table (
  role_code text,
  role_name text,
  capability_code text,
  capability_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from organizations.organizations as organization
    join organizations.organization_memberships as membership
      on membership.organization_id = organization.id
     and membership.person_id = p_person_id
     and membership.status = 'active'
    where organization.id = p_organization_id
      and organization.status = 'active'
  ) then
    raise exception 'organization membership is not available' using errcode = '42501';
  end if;

  return query
  select
    role.code,
    role.name,
    capability.code,
    capability.name
  from organizations.organization_roles as role
  left join organizations.role_capabilities as role_capability
    on role_capability.role_code = role.code
  left join organizations.organization_capabilities as capability
    on capability.code = role_capability.capability_code
  order by
    case role.code
      when 'owner' then 1
      when 'admin' then 2
      when 'coach' then 3
      else 4
    end,
    capability.code;
end
$function$;

alter function organizations.list_organization_memberships(uuid, uuid, text, integer, text, text, uuid)
  owner to allfit_owner;
alter function organizations.list_organization_roles(uuid, uuid) owner to allfit_owner;

revoke all on function organizations.list_organization_memberships(uuid, uuid, text, integer, text, text, uuid)
  from public;
revoke all on function organizations.list_organization_roles(uuid, uuid) from public;

grant execute on function organizations.list_organization_memberships(uuid, uuid, text, integer, text, text, uuid)
  to allfit_api;
grant execute on function organizations.list_organization_roles(uuid, uuid) to allfit_api;
