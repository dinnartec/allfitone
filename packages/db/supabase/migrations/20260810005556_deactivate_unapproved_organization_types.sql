set lock_timeout = '5s';
set statement_timeout = '60s';

do $validation$
begin
  if exists (
    select 1
    from organizations.organizations as organization
    where organization.type_code in ('academy', 'clinic')
  ) then
    raise exception 'cannot deactivate organization types while organizations use academy or clinic'
      using errcode = '23514';
  end if;
end
$validation$;

update organizations.organization_types
set name = 'Profesional independiente'
where code = 'professional_practice';

update organizations.organization_types
set active = false
where code in ('academy', 'clinic');

do $validation$
begin
  if not exists (
    select 1
    from organizations.organization_types as organization_type
    where organization_type.code = 'professional_practice'
      and organization_type.name = 'Profesional independiente'
      and organization_type.active
  ) or (
    select count(*)
    from organizations.organization_types as organization_type
    where organization_type.code in ('academy', 'clinic')
      and not organization_type.active
  ) <> 2 then
    raise exception 'organization type catalogue did not reach the expected active state'
      using errcode = '23514';
  end if;
end
$validation$;
