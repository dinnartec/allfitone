begin;

-- The deferred duty invariant runs at commit under the workflow role. Keep the
-- workflow role without direct table access and evaluate the closed invariant
-- with the function owner instead.
alter function support.require_active_platform_role_for_duty() security definer;

commit;
