-- Binarios personales en PostgreSQL — `ADR-031`, `HU-SP-109`, `OP-PLN-031`, `OP-PLN-032`.
--
-- La portada de una rutina puede ser una foto que la persona sube. Los bytes viven aquí
-- y no en un bucket, y la razón de peso es el borrado: `ADR-012` exige que la supresión
-- alcance también el almacén, y con los bytes dentro de la transacción el `delete` **es**
-- esa confirmación. Con un bucket haría falta un worker, reintentos y un estado en el que
-- el dato ya se dijo borrado y todavía existe.
--
-- **Lo que se guarda es lo que produjo el saneado del servidor**, nunca lo que llegó. La
-- API decodifica y vuelve a codificar, lo que borra EXIF y geolocalización por
-- construcción; si no decodifica, no se guarda nada. La base no puede comprobarlo, así
-- que fija lo que sí puede: un solo tipo de contenido, un tamaño máximo y un checksum.
--
-- **La clave foránea de la versión es compuesta.** Sin ella, un borrador podría nombrar
-- la foto de otra persona y publicarse con ella: el identificador sería válido y la
-- referencia simple no tendría nada que objetar. Con `(id, template_id)` la foto y la
-- plantilla tienen que ser la misma pareja, que es la misma idea de `IX-01`.
--
-- **Una foto que una versión publicada referencia no se destruye.** La versión es
-- inmutable y su portada tiene que seguir existiendo, así que la recolección deja
-- exactamente esas y borra las demás.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- La prueba de que unos bytes personales dejaron de existir, escrita por la misma
-- transacción que los destruyó.
--
-- **No es `privacy.disposition_events`**, que el diccionario ya describe como el registro
-- de ejecución del pipeline de retención programada —particionado, colgando de
-- `disposition_items` y escrito por un worker— y que sigue sin modelo físico junto a
-- `retention_policies`, `erasure_requests` y `legal_holds`. Esto es más pequeño y más
-- inmediato: la destrucción que alguien pide, no la que un calendario dispara. Cuando ese
-- pipeline se construya, esta tabla será una de sus fuentes.
create table privacy.binary_disposals (
  id uuid not null default extensions.uuid_generate_v7(),
  subject_person_id uuid not null,
  object_kind text not null,
  object_id uuid not null,
  byte_size integer not null,
  reason text not null,
  disposed_at timestamptz not null default clock_timestamp(),
  constraint pk_binary_disposals primary key (id),
  constraint fk_binary_disposals_subject foreign key (subject_person_id) references identity.people(id) on delete restrict,
  constraint ck_binary_disposals_kind check (object_kind in ('routine_cover_photo')),
  constraint ck_binary_disposals_reason check (reason in ('replaced', 'removed', 'content_discarded')),
  constraint ck_binary_disposals_size check (byte_size > 0)
);

create index idx_binary_disposals_subject on privacy.binary_disposals (subject_person_id, disposed_at desc);

alter table privacy.binary_disposals enable row level security;
alter table privacy.binary_disposals force row level security;

-- La misma forma que `privacy.access_events`: el runtime no la lee directamente, la
-- sirve una función `security definer` que decide a quién le toca.
create policy binary_disposals_all_owner on privacy.binary_disposals
  for all to allfit_owner using (true) with check (true);

revoke all on privacy.binary_disposals from public, allfit_api;

create table planning.session_template_cover_photos (
  id uuid not null default extensions.uuid_generate_v7(),
  template_id uuid not null,
  content_type text not null,
  byte_size integer not null,
  checksum bytea not null,
  bytes bytea not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_session_template_cover_photos primary key (id),
  -- Lo que sostiene la clave foránea compuesta de la versión.
  constraint uq_session_template_cover_photos_template unique (id, template_id),
  constraint fk_session_template_cover_photos_template foreign key (template_id) references planning.session_templates(id) on delete cascade,
  -- Un solo formato porque el servidor lo produce: aceptar lo que llegue sería aceptar
  -- que los bytes no pasaron por el saneado.
  constraint ck_session_template_cover_photos_type check (content_type = 'image/webp'),
  constraint ck_session_template_cover_photos_size check (byte_size > 0 and byte_size <= 1048576),
  constraint ck_session_template_cover_photos_checksum check (octet_length(checksum) = 32),
  constraint ck_session_template_cover_photos_bytes check (octet_length(bytes) = byte_size)
);

create index idx_session_template_cover_photos_template on planning.session_template_cover_photos (template_id, created_at desc);

alter table planning.session_template_cover_photos enable row level security;
alter table planning.session_template_cover_photos force row level security;

-- `T-TPL-11` — heredada de la plantilla, igual que `planned_steps` y los targets: la
-- política del padre ya filtra por dueño, así que una fila sólo es alcanzable si su
-- plantilla lo es. Para quien no lo sea, ausente y prohibido responden igual.
create policy session_template_cover_photos_all_actor_access on planning.session_template_cover_photos
  for all to allfit_owner
  using (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ))
  with check (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ));

revoke all on planning.session_template_cover_photos from public, allfit_api;

-- La destrucción deja huella pase por donde pase: borrado explícito, recolección o el
-- cascade de descartar la plantilla.
create or replace function planning.record_cover_photo_disposition_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  owner_id uuid;
begin
  select owned.owner_person_id into owner_id
  from planning.session_templates as owned where owned.id = old.template_id;
  if owner_id is null then return old; end if;

  insert into privacy.binary_disposals (subject_person_id, object_kind, object_id, byte_size, reason)
  values (
    owner_id, 'routine_cover_photo', old.id, old.byte_size,
    coalesce(nullif(current_setting('app.disposition_reason', true), ''), 'removed')
  );
  return old;
end
$function$;

alter function planning.record_cover_photo_disposition_tg() owner to allfit_owner;

create trigger trg_record_cover_photo_disposition
  after delete on planning.session_template_cover_photos
  for each row execute function planning.record_cover_photo_disposition_tg();

alter table planning.session_template_versions add column cover_photo_id uuid;

alter table planning.session_template_versions drop constraint ck_session_template_versions_cover;

alter table planning.session_template_versions
  add constraint fk_session_template_versions_cover_photo foreign key (cover_photo_id, template_id) references planning.session_template_cover_photos(id, template_id) on delete restrict,
  -- Cada clase lleva exactamente su carga y ninguna otra. `is not distinct from` porque
  -- con `cover_kind` nulo la igualdad daría nulo y el check pasaría por desconocido.
  add constraint ck_session_template_versions_cover check (
    (cover_icon is not null) = (cover_kind is not distinct from 'icon')
    and (cover_photo_id is not null) = (cover_kind is not distinct from 'photo')
  );

commit;
