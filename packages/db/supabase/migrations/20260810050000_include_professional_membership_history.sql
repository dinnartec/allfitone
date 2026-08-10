-- Include personal organization history in the consolidated professional context.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.get_my_professional_context(
  p_person_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  profile_id uuid;
  profile_body jsonb;
  membership_body jsonb;
begin
  perform identity.require_professional_actor(p_person_id);

  select profile.id into profile_id
  from identity.professional_profiles as profile
  where profile.person_id = p_person_id;

  perform privacy.log_access_event(
    p_person_id,
    p_person_id,
    'professional_profile',
    profile_id,
    'studio_self_service',
    'allowed',
    p_request_id
  );

  if profile_id is not null then
    profile_body := identity.professional_profile_projection(profile_id);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'membership_id', membership.id,
      'organization_id', organization.id,
      'display_name', organization.display_name,
      'type_code', organization.type_code,
      'status', membership.status,
      'joined_at', membership.joined_at,
      'ended_at', membership.ended_at,
      'roles', coalesce((
        select jsonb_agg(role.role_code order by role.role_code)
        from organizations.membership_roles as role
        where role.membership_id = membership.id
          and (
            (
              membership.status = 'active'
              and role.valid_from <= clock_timestamp()
              and (role.valid_to is null or role.valid_to >= clock_timestamp())
            )
            or (
              membership.status = 'terminated'
              and role.valid_from <= membership.ended_at
              and (role.valid_to is null or role.valid_to >= membership.ended_at)
            )
          )
      ), '[]'::jsonb)
    ) order by
      case membership.status when 'active' then 0 else 1 end,
      case when membership.status = 'active' then organization.display_name end,
      case when membership.status = 'terminated' then membership.ended_at end desc,
      organization.display_name,
      membership.id
  ), '[]'::jsonb)
  into membership_body
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where membership.person_id = p_person_id;

  return jsonb_build_object('profile', profile_body, 'memberships', membership_body);
end
$function$;

alter function identity.get_my_professional_context(uuid, uuid) owner to allfit_owner;
revoke all on function identity.get_my_professional_context(uuid, uuid) from public;
grant execute on function identity.get_my_professional_context(uuid, uuid) to allfit_api;
