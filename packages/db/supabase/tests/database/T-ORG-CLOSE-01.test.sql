-- T-ORG-CLOSE-01 — `HU-BO-017` is deferred, and this is what V1 asks of it.
--
-- The traceability matrix records the decision: **no platform closure distinct from the
-- closure governed by the owner**, to be reconsidered with legal policy. Its V1 scope is
-- `deferred`, its objects are "Sin objetos V1", and the obligation is to *prove the
-- absence* of DDL, permissions and routes rather than to build any of them.
--
-- An absence is only worth asserting if it would notice the thing appearing, so this
-- names what exists instead of guessing at names that do not. Any new relationship
-- command the runtime can reach fails the first assertion, whatever it is called, and
-- whoever adds one has to come here and say why it is not the closure that was deferred.
--
-- The route half lives beside the contract, in the API's own gate: nothing under
-- `/backoffice/v1` reaches a relationship, and no operation claims
-- `NEW-ORG-PLATFORM-CLOSE`.

begin;

select plan(5);

-- ---------------------------------------------------------------------------
-- No permission: what the runtime may run in `relationships`, exhaustively
-- ---------------------------------------------------------------------------

-- Naming all of them, rather than asserting that no name matches `terminate%`, is the
-- point: a closure called anything at all breaks this, and whoever adds a function to
-- `relationships` has to say out loud that theirs is not one. It has already worked
-- five times — `read_relationship_state` and `reassign_relationship_holder` arrived with
-- `AFO-54`/`AFO-57`, `read_relationship_history` with `AFO-55`,
-- `propose_substitution` with `AFO-58`, `list_my_relationships` with `OP-REL-012` and
-- `relationship_assignment_is_visible` with `STUDIO-94`; each landed here before it
-- landed anywhere else.
--
-- The last one is not an operation. It is the assignment read policy's predicate,
-- lifted into a function so the policy reads as one line, and the runtime holds
-- EXECUTE because a policy is evaluated as whoever is reading.
--
-- `list_my_relationships` is a read the **person** performs over her own rows, and it is
-- what makes everything about one of her gyms reachable from Space at all. It ends
-- nothing, it writes nothing, and the closure that stays deferred is Allfit ending a
-- relationship over the gym's head.
--
-- Only the function the API calls appears. `history_cursor` and
-- `history_cursor_parts` came with the same migration and are deliberately absent:
-- encoding a cursor is not an operation anybody outside the function needs.
--
-- Collated explicitly: `proname` is a `name`, and comparing those without saying how
-- to sort them is what PostgreSQL refuses.
select is(
  (select string_agg(runnable.name, ', ' order by runnable.name)
   from (
     select routine.proname::text collate "C" as name
     from pg_proc as routine
     join pg_namespace as space on space.oid = routine.pronamespace
     where space.nspname = 'relationships'
       and routine.prokind = 'f'
       and has_function_privilege('allfit_api', routine.oid, 'EXECUTE')
   ) as runnable),
  'actor_is_assigned, assign_relationship_holder, list_my_relationships, '
    || 'list_organization_clients, propose_substitution, read_relationship_history, '
    || 'read_relationship_state, reassign_relationship_holder, '
    || 'relationship_assignment_is_visible',
  'the runtime reaches nine relationship functions, and ending one is not among them'
);

-- ---------------------------------------------------------------------------
-- No DDL: nothing models a closure the platform decides
-- ---------------------------------------------------------------------------

-- The gym asking to end a relationship is a legitimate piece that is simply not built
-- yet; Allfit ending it over the gym's head is the one that was ruled out. Neither
-- exists, so neither has a table.
select is(
  (select count(*)::integer
   from information_schema.tables
   where table_schema = 'relationships'
     and table_name in ('relationship_termination_requests', 'platform_closures')),
  0,
  'no table records a termination request, by the gym or by the platform'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'organizations'
     and table_name = 'organizations'
     and column_name in ('closed_by_platform_at', 'platform_closure_reason')),
  0,
  'and an organization carries no mark of having been closed by Allfit'
);

-- `cancelled` is the state a gym nobody claimed reaches through `HU-BO-015`, which is
-- a different thing from ending the relationships of one that operates.
select is(
  (select string_agg(label.enumlabel::text collate "C", ', ' order by label.enumsortorder)
   from pg_enum as label
   join pg_type as kind on kind.oid = label.enumtypid
   where kind.typname = 'organization_status'),
  'unclaimed, active, closed, cancelled',
  'the lifecycle gained no state for a platform closure'
);

-- ---------------------------------------------------------------------------
-- And the runtime writes no relationship directly either
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'relationships.service_relationships', 'UPDATE, DELETE')
  and not has_table_privilege(
    'allfit_api', 'relationships.relationship_professional_assignments', 'UPDATE, DELETE'
  ),
  'so a closure cannot be done by hand through the tables either'
);

select * from finish();
rollback;
