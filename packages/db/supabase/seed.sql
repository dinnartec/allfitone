-- Development and integration-test seed data belongs here.
-- Keep schema changes in supabase/migrations; this file contains INSERTs only.

-- Synthetic local catalogue. Production does not load seed.sql and requires approved curation.
insert into catalog.disciplines (id, code, name, status)
values
  ('019c0000-0000-7000-8000-000000000001', 'test_strength', 'Fuerza de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000002', 'test_endurance', 'Resistencia de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000003', 'test_interval', 'Intervalos de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000004', 'test_mobility', 'Movilidad de prueba', 'published');

insert into catalog.activity_types (id, discipline_code, code, name, status)
values
  ('019c0000-0000-7000-8000-000000000011', 'test_strength', 'test_strength_session', 'Sesión de fuerza de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000012', 'test_endurance', 'test_endurance_session', 'Sesión de resistencia de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000013', 'test_interval', 'test_interval_session', 'Sesión de intervalos de prueba', 'published'),
  ('019c0000-0000-7000-8000-000000000014', 'test_mobility', 'test_mobility_session', 'Sesión de movilidad de prueba', 'published');

insert into catalog.units (id, code, dimension, is_canonical, to_canonical_factor)
values
  ('019c0000-0000-7000-8000-000000000021', 'test_kg', 'test_mass', true, 1),
  ('019c0000-0000-7000-8000-000000000022', 'test_m', 'test_distance', true, 1),
  ('019c0000-0000-7000-8000-000000000023', 'test_s_per_m', 'test_pace', true, 1);

insert into catalog.result_contracts (
  id, contract_code, version_number, activity_family, envelope, minimums, status, published_at
)
values
  ('019c0000-0000-7000-8000-000000000031', 'test.strength', 1, 'strength', '{"schema":1}', '{"target_sets":true}', 'published', clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000032', 'test.endurance', 1, 'endurance', '{"schema":1}', '{"distance_or_duration":true}', 'published', clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000033', 'test.interval', 1, 'interval', '{"schema":1}', '{"rounds":true}', 'published', clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000034', 'test.mobility', 1, 'mobility', '{"schema":1}', '{"hold_or_repetitions":true}', 'published', clock_timestamp());

insert into catalog.activity_type_result_contracts (
  id, activity_type_id, result_contract_id, is_default, valid_from
)
values
  ('019c0000-0000-7000-8000-000000000041', '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', true, clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000042', '019c0000-0000-7000-8000-000000000012', '019c0000-0000-7000-8000-000000000032', true, clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000043', '019c0000-0000-7000-8000-000000000013', '019c0000-0000-7000-8000-000000000033', true, clock_timestamp()),
  ('019c0000-0000-7000-8000-000000000044', '019c0000-0000-7000-8000-000000000014', '019c0000-0000-7000-8000-000000000034', true, clock_timestamp());
