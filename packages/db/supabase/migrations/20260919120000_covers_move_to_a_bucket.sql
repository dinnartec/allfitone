-- Las portadas salen de PostgreSQL a un bucket privado — `ADR-031`, enmendada.
--
-- La razón original para meter los bytes aquí tenía cuatro patas y una se midió y era
-- falsa: «el volumen no lo justifica». El modelo real del producto son dos programas por
-- persona, seis rutinas por programa y foto en todas —doce fotos de unos setenta
-- kilobytes, 822 KB por persona—, y la cuota de base de datos del plan son 500 MB. Eso
-- son **seiscientas personas** llenando la base entera, y esa cuota es para rutinas,
-- programas, sesiones e historial, no para imágenes.
--
-- Lo que **no** cambia es quién decide. La API sigue sirviendo los bytes y reevaluando la
-- autorización en cada petición; el bucket no sabe qué es una persona ni qué es ser dueño
-- de una plantilla. Es un cubo tonto, y por eso se puede cambiar de proveedor sin tocar
-- una sola regla de permisos.
--
-- Tres condiciones sostienen esa portabilidad, y esta migración fija la que se puede fijar
-- en la base: **la fila guarda la clave del objeto, jamás una URL**. Una URL ataría cada
-- fila al proveedor y obligaría a reescribirlas el día que se cambie; la base del endpoint
-- vive en configuración, como `catalog.movement_media` ya hace.
--
-- **El borrado deja de ser una sola sentencia**, y es el precio que se paga. Antes el
-- `delete` era la confirmación que `ADR-012` exige. Ahora la transacción anota la
-- disposición **pendiente** con la clave, y un trabajo programado borra el objeto y la
-- sella. Entre las dos hay una ventana en la que la fila ya no existe y el objeto sí; es
-- medible —una pendiente con antigüedad— y por eso `purged_at` nace nullable en vez de
-- fingir que el borrado fue instantáneo.
--
-- `bytes` sobrevive a esta migración **a propósito**, vacía de aquí en adelante. Soltarla
-- en el mismo paso que se suben los objetos dejaría la única copia en un archivo temporal
-- durante la ventana en que algo puede fallar. La suelta una migración posterior, cuando
-- los objetos estén verificados por checksum en el bucket.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- La clave es derivable de lo que la fila ya sabe, así que las que existen se rellenan
-- solas y sus objetos se suben exactamente a esa ruta.
alter table planning.session_template_cover_photos add column object_key text;

update planning.session_template_cover_photos
set object_key = 'covers/' || template_id::text || '/' || id::text || '.webp'
where object_key is null;

alter table planning.session_template_cover_photos
  alter column object_key set not null,
  alter column bytes drop not null,
  drop constraint ck_session_template_cover_photos_bytes,
  -- Dos filas apuntando al mismo objeto harían que borrar una destruyese la otra.
  add constraint uq_session_template_cover_photos_object unique (object_key),
  -- Una clave, no una URL: si empieza por un esquema, alguien guardó el proveedor dentro
  -- del dato.
  add constraint ck_session_template_cover_photos_object_key check (
    object_key like 'covers/%' and object_key !~ '://'
  ),
  add constraint ck_session_template_cover_photos_bytes check (
    bytes is null or octet_length(bytes) = byte_size
  );

comment on column planning.session_template_cover_photos.bytes is
  'Transitoria. Vacía desde `ADR-031` enmendada; la suelta una migración posterior.';

-- El recibo pasa a ser también la cola: sin la clave, nadie sabe qué objeto borrar.
alter table privacy.binary_disposals
  add column object_key text,
  add column purged_at timestamptz,
  add column purge_attempts integer not null default 0,
  add constraint ck_binary_disposals_purged check (purged_at is null or purged_at >= disposed_at),
  add constraint ck_binary_disposals_attempts check (purge_attempts >= 0);

-- Las que ya existen no tienen objeto que borrar: sus bytes murieron con la fila, dentro
-- de la transacción. Sellarlas con su propia fecha dice la verdad y las saca de la cola.
update privacy.binary_disposals set purged_at = disposed_at where purged_at is null;

create index idx_binary_disposals_pending on privacy.binary_disposals (disposed_at)
  where purged_at is null;

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

  -- Pendiente a propósito: los bytes viven fuera de esta transacción y todavía existen.
  insert into privacy.binary_disposals (
    subject_person_id, object_kind, object_id, object_key, byte_size, reason
  )
  values (
    owner_id, 'routine_cover_photo', old.id, old.object_key, old.byte_size,
    coalesce(nullif(current_setting('app.disposition_reason', true), ''), 'removed')
  );
  return old;
end
$function$;

alter function planning.record_cover_photo_disposition_tg() owner to allfit_owner;

-- La firma cambia, así que la vieja se retira en vez de quedar como sobrecarga.
drop function planning.upload_my_cover_photo(uuid, uuid, bytea, uuid, uuid, bytea);

-- `OP-PLN-031`. Los bytes ya están en el bucket cuando esto corre: el objeto primero y la
-- fila después, para que un fallo deje un huérfano que la reconciliación barre y nunca una
-- fila apuntando a nada.
create or replace function planning.upload_my_cover_photo(
  p_person_id uuid,
  p_template_id uuid,
  p_object_key text,
  p_byte_size integer,
  p_checksum bytea,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (photo jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  owned planning.session_templates%rowtype;
  photo_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-031', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select jsonb_build_object('id', receipt.aggregate_id), true;
    return;
  end if;

  select * into owned
  from planning.session_templates as template
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update;
  if owned.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  insert into planning.session_template_cover_photos (
    template_id, content_type, byte_size, checksum, object_key
  )
  values (p_template_id, 'image/webp', p_byte_size, p_checksum, p_object_key)
  returning id into photo_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'routine-cover-photo-stored',
    'session_template_cover_photo', photo_id
  );
  return query select jsonb_build_object('id', photo_id), false;
end
$function$;

alter function planning.upload_my_cover_photo(uuid, uuid, text, integer, bytea, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.upload_my_cover_photo(uuid, uuid, text, integer, bytea, uuid, uuid, bytea) from public;
grant execute on function planning.upload_my_cover_photo(uuid, uuid, text, integer, bytea, uuid, uuid, bytea) to allfit_api;

drop function planning.read_my_cover_photo(uuid, uuid);

-- `OP-PLN-032`. Devuelve dónde están los bytes, no los bytes: **aquí es donde vive el
-- permiso**, y quien no sea la dueña no recibe ni la clave. La API descarga el objeto
-- después y lo sirve; ninguna respuesta la expone.
create or replace function planning.read_my_cover_photo(p_person_id uuid, p_photo_id uuid)
returns table (content_type text, byte_size integer, object_key text)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select picture.content_type, picture.byte_size, picture.object_key
  from planning.session_template_cover_photos as picture
  join planning.session_templates as owned on owned.id = picture.template_id
  where picture.id = p_photo_id and owned.owner_person_id = p_person_id
$function$;

alter function planning.read_my_cover_photo(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_my_cover_photo(uuid, uuid) from public;
grant execute on function planning.read_my_cover_photo(uuid, uuid) to allfit_api;

-- La otra mitad del borrado, la que cierra la ventana.
--
-- Toma las pendientes más viejas primero y cuenta el intento en la misma vuelta, así que
-- un objeto que el almacén no deja borrar no bloquea la cola detrás de él ni se reintenta
-- para siempre en silencio: el contador es lo que hace visible que algo va mal.
create or replace function privacy.claim_binary_disposals(p_limit integer)
returns table (id uuid, object_kind text, object_key text, purge_attempts integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if p_limit not between 1 and 500 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  return query
  update privacy.binary_disposals as disposal
  set purge_attempts = disposal.purge_attempts + 1
  where disposal.id in (
    select pending.id from privacy.binary_disposals as pending
    where pending.purged_at is null and pending.object_key is not null
    order by pending.disposed_at
    limit p_limit
    for update skip locked
  )
  returning disposal.id, disposal.object_kind, disposal.object_key, disposal.purge_attempts;
end
$function$;

alter function privacy.claim_binary_disposals(integer) owner to allfit_owner;
revoke all on function privacy.claim_binary_disposals(integer) from public;
grant execute on function privacy.claim_binary_disposals(integer) to allfit_api;

-- La confirmación que `ADR-012` exige. Se sella una vez: volver a sellarla no mueve la
-- fecha, porque la primera es cuando el objeto dejó de existir.
create or replace function privacy.seal_binary_disposal(p_disposal_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog
as $function$
  update privacy.binary_disposals
  set purged_at = clock_timestamp()
  where id = p_disposal_id and purged_at is null
  returning true
$function$;

alter function privacy.seal_binary_disposal(uuid) owner to allfit_owner;
revoke all on function privacy.seal_binary_disposal(uuid) from public;
grant execute on function privacy.seal_binary_disposal(uuid) to allfit_api;

commit;
