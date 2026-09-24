-- Los bytes se van de la base — `ADR-031`, enmendada.
--
-- La migración anterior dejó `bytes` en pie a propósito: mientras los objetos no
-- estuvieran en el bucket, esa columna era la única copia. Ya lo están, verificados por
-- el checksum que la fila guarda, así que la copia sobra y sostenerla sería mantener en
-- la base exactamente lo que este trabajo existe para sacar de ella.
--
-- Suelta la columna y nada más. Las claves, la cola de disposición y las funciones ya
-- viven en la migración anterior.

set statement_timeout = '60s';

begin;

set lock_timeout = '5s';

alter table planning.session_template_cover_photos
  drop constraint ck_session_template_cover_photos_bytes,
  drop column bytes;

commit;
