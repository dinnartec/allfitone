-- Las dos tablas nuevas pasan a `allfit_owner`, como sus hermanas.
--
-- Sus políticas de fila están escritas `to allfit_owner`, que es el rol con el que la
-- plataforma abre la transacción; sin ser dueñas de la tabla, ese rol no tiene ni el
-- privilegio para llegar a la política. `planning.planned_sets` ya lo hace así.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table planning.session_template_cover_photos owner to allfit_owner;
alter table privacy.binary_disposals owner to allfit_owner;

revoke all on planning.session_template_cover_photos from public, allfit_api;
revoke all on privacy.binary_disposals from public, allfit_api;

commit;
