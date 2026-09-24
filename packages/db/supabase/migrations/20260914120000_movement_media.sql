-- The demonstration of a movement, for somebody who cannot deduce it from the name.
--
-- `V1_DATA_DICTIONARY.md` §8.18 defines the table; this builds it.
--
-- **The row points at the object; it does not hold it.** A demonstration is identical
-- for everybody, immutable, and large. It belongs behind a cache with a long life, not
-- in a column and not streamed by the API on every request. That is the opposite of the
-- meal photo, which **is** streamed per request precisely because it is personal data
-- whose authorization has to be re-evaluated every time. Here the control is
-- immutability; there it is authorization.
--
-- **And it stores a key, never a URL.** An absolute address written into a row ties the
-- content to whatever origin served it the day it was written, so changing provider
-- would mean migrating data. The API composes the address from configuration when it
-- projects, which makes the origin an environment variable.
--
-- `checksum` is what makes the curation reproducible: it says which bytes were
-- reviewed. If the object in the store no longer matches, somebody changed the content
-- without passing through the review of the change.
--
-- Visibility is inherited from the parent movement rather than restated, the same as
-- the other four children. `allfit_api` gets `select` and nothing more: this is curated
-- content, and a demonstration written from the product would be a change to what an
-- exercise looks like with nobody reviewing it.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create table catalog.movement_media (
  id uuid not null default extensions.uuid_generate_v7(),
  movement_id uuid not null,
  kind text not null default 'demo',
  object_key text not null,
  content_type text not null,
  width integer not null,
  height integer not null,
  byte_size integer not null,
  checksum text not null,
  constraint pk_movement_media primary key (id),
  constraint fk_movement_media_movement foreign key (movement_id) references catalog.movements(id) on delete cascade,
  -- One demonstration per movement: two would be a choice nobody made.
  constraint uq_movement_media unique (movement_id, kind),
  constraint ck_movement_media_kind check (kind in ('demo')),
  -- A key, not a URL. The scheme would be the origin leaking into the data.
  constraint ck_movement_media_object_key check (
    btrim(object_key) <> '' and object_key !~ '^[a-z][a-z0-9+.-]*://'
  ),
  constraint ck_movement_media_content_type check (content_type ~ '^image/[a-z0-9.+-]+$'),
  constraint ck_movement_media_dimensions check (width > 0 and height > 0),
  constraint ck_movement_media_byte_size check (byte_size > 0),
  constraint ck_movement_media_checksum check (btrim(checksum) <> '')
);

create index idx_movement_media_movement on catalog.movement_media (movement_id);

alter table catalog.movement_media enable row level security;
alter table catalog.movement_media force row level security;

create policy movement_media_select_actor on catalog.movement_media
  for select
  using (exists (select 1 from catalog.movements as movement where movement.id = movement_id));

alter table catalog.movement_media owner to allfit_owner;

grant select on catalog.movement_media to allfit_api;

commit;
