-- Veinte portadas más — `HU-SP-108`.
--
-- Doce alcanzaban para probar la idea y no para que alguien con quince rutinas las
-- distinga. Siguen diciendo **de qué va** la rutina y no con qué se hace, que es la
-- distinción que separa esto del catálogo de equipamiento.
--
-- Los valores se añaden al final y **ningún identificador se reordena ni se reutiliza**:
-- una rutina guardada con `strength` tiene que seguir dibujando lo mismo dentro de un
-- año. El orden de la rejilla lo decide la aplicación, no este enumerado.
--
-- `session_content_errors` valida contra `pg_enum`, así que no hay ninguna restricción
-- que nombre estos literales y añadirlos no obliga a mover nada más.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type planning.routine_cover_icon add value if not exists 'arms';
alter type planning.routine_cover_icon add value if not exists 'weights';
alter type planning.routine_cover_icon add value if not exists 'technique';
alter type planning.routine_cover_icon add value if not exists 'endurance';
alter type planning.routine_cover_icon add value if not exists 'pace';
alter type planning.routine_cover_icon add value if not exists 'energy';
alter type planning.routine_cover_icon add value if not exists 'focus';
alter type planning.routine_cover_icon add value if not exists 'recovery';
alter type planning.routine_cover_icon add value if not exists 'morning';
alter type planning.routine_cover_icon add value if not exists 'evening';
alter type planning.routine_cover_icon add value if not exists 'night';
alter type planning.routine_cover_icon add value if not exists 'cold';
alter type planning.routine_cover_icon add value if not exists 'outdoor';
alter type planning.routine_cover_icon add value if not exists 'route';
alter type planning.routine_cover_icon add value if not exists 'pool';
alter type planning.routine_cover_icon add value if not exists 'team';
alter type planning.routine_cover_icon add value if not exists 'record';
alter type planning.routine_cover_icon add value if not exists 'favourite';
alter type planning.routine_cover_icon add value if not exists 'light';
alter type planning.routine_cover_icon add value if not exists 'countdown';

commit;
