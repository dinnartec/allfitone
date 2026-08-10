-- Keep fail-closed access auditing available beyond the initial partition horizon.

set lock_timeout = '5s';
set statement_timeout = '60s';

create table privacy.access_events_2026_12 partition of privacy.access_events
  for values from ('2026-12-01 00:00:00+00') to ('2027-01-01 00:00:00+00');
create table privacy.access_events_2027_01 partition of privacy.access_events
  for values from ('2027-01-01 00:00:00+00') to ('2027-02-01 00:00:00+00');
create table privacy.access_events_2027_02 partition of privacy.access_events
  for values from ('2027-02-01 00:00:00+00') to ('2027-03-01 00:00:00+00');
create table privacy.access_events_2027_03 partition of privacy.access_events
  for values from ('2027-03-01 00:00:00+00') to ('2027-04-01 00:00:00+00');
create table privacy.access_events_2027_04 partition of privacy.access_events
  for values from ('2027-04-01 00:00:00+00') to ('2027-05-01 00:00:00+00');
create table privacy.access_events_2027_05 partition of privacy.access_events
  for values from ('2027-05-01 00:00:00+00') to ('2027-06-01 00:00:00+00');
create table privacy.access_events_2027_06 partition of privacy.access_events
  for values from ('2027-06-01 00:00:00+00') to ('2027-07-01 00:00:00+00');
create table privacy.access_events_2027_07 partition of privacy.access_events
  for values from ('2027-07-01 00:00:00+00') to ('2027-08-01 00:00:00+00');
create table privacy.access_events_2027_08 partition of privacy.access_events
  for values from ('2027-08-01 00:00:00+00') to ('2027-09-01 00:00:00+00');
create table privacy.access_events_2027_09 partition of privacy.access_events
  for values from ('2027-09-01 00:00:00+00') to ('2027-10-01 00:00:00+00');
create table privacy.access_events_2027_10 partition of privacy.access_events
  for values from ('2027-10-01 00:00:00+00') to ('2027-11-01 00:00:00+00');
create table privacy.access_events_2027_11 partition of privacy.access_events
  for values from ('2027-11-01 00:00:00+00') to ('2027-12-01 00:00:00+00');
create table privacy.access_events_2027_12 partition of privacy.access_events
  for values from ('2027-12-01 00:00:00+00') to ('2028-01-01 00:00:00+00');
create table privacy.access_events_default partition of privacy.access_events default;

alter table privacy.access_events_2026_12 owner to allfit_owner;
alter table privacy.access_events_2027_01 owner to allfit_owner;
alter table privacy.access_events_2027_02 owner to allfit_owner;
alter table privacy.access_events_2027_03 owner to allfit_owner;
alter table privacy.access_events_2027_04 owner to allfit_owner;
alter table privacy.access_events_2027_05 owner to allfit_owner;
alter table privacy.access_events_2027_06 owner to allfit_owner;
alter table privacy.access_events_2027_07 owner to allfit_owner;
alter table privacy.access_events_2027_08 owner to allfit_owner;
alter table privacy.access_events_2027_09 owner to allfit_owner;
alter table privacy.access_events_2027_10 owner to allfit_owner;
alter table privacy.access_events_2027_11 owner to allfit_owner;
alter table privacy.access_events_2027_12 owner to allfit_owner;
alter table privacy.access_events_default owner to allfit_owner;

alter table privacy.access_events_2026_12 enable row level security;
alter table privacy.access_events_2026_12 force row level security;
alter table privacy.access_events_2027_01 enable row level security;
alter table privacy.access_events_2027_01 force row level security;
alter table privacy.access_events_2027_02 enable row level security;
alter table privacy.access_events_2027_02 force row level security;
alter table privacy.access_events_2027_03 enable row level security;
alter table privacy.access_events_2027_03 force row level security;
alter table privacy.access_events_2027_04 enable row level security;
alter table privacy.access_events_2027_04 force row level security;
alter table privacy.access_events_2027_05 enable row level security;
alter table privacy.access_events_2027_05 force row level security;
alter table privacy.access_events_2027_06 enable row level security;
alter table privacy.access_events_2027_06 force row level security;
alter table privacy.access_events_2027_07 enable row level security;
alter table privacy.access_events_2027_07 force row level security;
alter table privacy.access_events_2027_08 enable row level security;
alter table privacy.access_events_2027_08 force row level security;
alter table privacy.access_events_2027_09 enable row level security;
alter table privacy.access_events_2027_09 force row level security;
alter table privacy.access_events_2027_10 enable row level security;
alter table privacy.access_events_2027_10 force row level security;
alter table privacy.access_events_2027_11 enable row level security;
alter table privacy.access_events_2027_11 force row level security;
alter table privacy.access_events_2027_12 enable row level security;
alter table privacy.access_events_2027_12 force row level security;
alter table privacy.access_events_default enable row level security;
alter table privacy.access_events_default force row level security;

revoke all on table
  privacy.access_events_2026_12,
  privacy.access_events_2027_01,
  privacy.access_events_2027_02,
  privacy.access_events_2027_03,
  privacy.access_events_2027_04,
  privacy.access_events_2027_05,
  privacy.access_events_2027_06,
  privacy.access_events_2027_07,
  privacy.access_events_2027_08,
  privacy.access_events_2027_09,
  privacy.access_events_2027_10,
  privacy.access_events_2027_11,
  privacy.access_events_2027_12,
  privacy.access_events_default
from public, allfit_api;
