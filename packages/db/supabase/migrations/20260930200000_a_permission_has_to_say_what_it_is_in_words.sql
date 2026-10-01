-- A permission has to be able to say what it is, in words a person can read.
--
-- `scope_definitions` holds `body_progress`, `health_context` and five more
-- codes, and nothing else legible: no title, no explanation. What the
-- projection does expose is the rule set — which fields of which resources the
-- scope covers — which is what Backoffice needs to curate the catalogue and
-- says nothing at all to the person being asked for their data.
--
-- So inviting somebody could not be built: the screen has no honest way to name
-- what it is asking for, and inventing those words in the client would put the
-- product's privacy vocabulary in a place nobody looks when it changes.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `scope_definitions`.
--
-- A published scope version is immutable, and deliberately so: it is the
-- contract somebody agreed to, and `trg_scope_definitions_immutable` refuses
-- any update to it. But a title is not part of that agreement — it is how the
-- agreement is presented. Fixing a typo in a description must not require
-- publishing a new contract version, which is what columns on that table would
-- have forced.
--
-- Keyed by code rather than by version for the same reason: "Progreso corporal"
-- does not change when the rules behind it are revised.
--
-- What the person actually accepted stays frozen regardless, in the
-- `presented_snapshot` the invitation records at the moment it is sent. Editing
-- a description here never rewrites what anybody already agreed to.

set lock_timeout = '5s';
set statement_timeout = '60s';

create table privacy.scope_presentations (
  scope_code text not null,
  display_name text not null,
  description text not null,
  -- The purpose a professional is allowed to state for asking. Fixed by the
  -- catalogue rather than written per invitation: a gym that composes its own
  -- justification for wanting health data writes it with nobody reviewing it,
  -- and two people asked for the same scope would read different reasons.
  default_purpose text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_scope_presentations primary key (scope_code),
  -- The same seven codes `ck_scope_definitions_code` admits. Duplicated because
  -- V1 has no enum or code table to point at; the two lists have to move
  -- together, and a code with no presentation is caught by the test rather than
  -- by a foreign key.
  constraint ck_scope_presentations_code check (scope_code in ('relationship_training', 'prior_training_history', 'body_progress', 'health_context', 'nutrition_intake', 'nutrition_guidance', 'nutrition_media')),
  constraint ck_scope_presentations_display_name check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  constraint ck_scope_presentations_description check (btrim(description) <> '' and char_length(description) <= 500),
  constraint ck_scope_presentations_purpose check (btrim(default_purpose) <> '' and char_length(default_purpose) <= 500)
);

/*
 * The wording follows the scope table in the domain glossary: what each one
 * covers in live access and, just as importantly, what it excludes. A person
 * deciding whether a gym may read their injuries is owed the boundary, not only
 * the invitation.
 */
insert into privacy.scope_presentations (scope_code, display_name, description, default_purpose)
values
  (
    'relationship_training',
    'Entrenamiento con nosotros',
    'Las sesiones que te asignemos y sus resultados, solo las que ocurran dentro de esta relación. No incluye lo que entrenes por tu cuenta, ni tu cuerpo, ni tu salud.',
    'Prescribir tu entrenamiento y revisar cómo te va en las sesiones que te asignamos.'
  ),
  (
    'prior_training_history',
    'Tu historial de entrenamiento',
    'Entrenamientos anteriores y por tu cuenta, y sus resultados. No incluye lo que hayas compartido con otras organizaciones, ni tu cuerpo, ni tu salud.',
    'Conocer tu punto de partida para no proponerte algo por encima o por debajo de lo que ya haces.'
  ),
  (
    'body_progress',
    'Progreso corporal',
    'Medidas, composición corporal, tendencias y las fotos que tú selecciones. No incluye tu galería, ni la ubicación de las fotos, ni datos de salud.',
    'Seguir cómo cambia tu cuerpo y ajustar el plan a lo que muestren las medidas.'
  ),
  (
    'health_context',
    'Contexto de salud',
    'Dolores, lesiones o limitaciones que tú declares, y tu recuperación. No incluye historia clínica, exámenes, medicamentos ni diagnósticos.',
    'Adaptar los ejercicios a tus lesiones o limitaciones para no hacerte daño.'
  ),
  (
    'nutrition_intake',
    'Lo que comes',
    'Las comidas que registres y lo que contienen. Solo las creas tú: un profesional nunca registra ni corrige una comida tuya.',
    'Entender tu alimentación para acompañarte con objetivos realistas.'
  ),
  (
    'nutrition_guidance',
    'Objetivos nutricionales',
    'Los objetivos de nutrición que te propongamos y las decisiones que tomes sobre ellos. No incluye tus comidas ni sus fotos, y nunca es prescripción médica.',
    'Proponerte objetivos de nutrición y revisar contigo si te sirven.'
  ),
  (
    'nutrition_media',
    'Fotos de tus comidas',
    'Las fotos que adjuntes a una comida. Requiere además que nos permitas ver lo que comes; por sí sola no muestra nada.',
    'Ver las fotos de tus comidas cuando el registro escrito no alcanza para entenderlas.'
  );

alter table privacy.scope_presentations enable row level security;
alter table privacy.scope_presentations force row level security;

/*
 * Readable by anyone signed in. This is the product's own vocabulary — the
 * names of the permissions it offers — and carries no data about any person.
 * A professional needs it to ask, and the person being asked needs the same
 * words to decide, so narrowing it to one surface would force a second copy.
 */
create policy scope_presentations_select_actor
  on privacy.scope_presentations
  for select to allfit_owner
  using (access_control.actor_kind() = 'person');

/*
 * No write policy, and none is missing. This is a catalogue: the rows arrive
 * with the migration that defines them, and `allfit_api` is granted `select`
 * and nothing else. A policy admitting writes would describe a caller that does
 * not exist.
 */

alter table privacy.scope_presentations owner to allfit_owner;
revoke all on table privacy.scope_presentations from public;
grant select on table privacy.scope_presentations to allfit_api;

/*
 * What a professional reads to build an invitation: every published scope with
 * the words for it, and the version number the offer has to be frozen against.
 *
 * `list_scope_definitions` could not be reused: it demands the global catalogue
 * curator role, which is a Backoffice duty, and it returns the rule set rather
 * than anything a person could read.
 */
create or replace function privacy.list_offerable_scopes()
returns table (
  scope_definition_id uuid,
  scope_code text,
  version_number integer,
  display_name text,
  description text,
  default_purpose text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  -- The latest published version of each code. An older version stays valid for
  -- grants already issued against it, but a new invitation always offers the
  -- current one.
  select distinct on (definition.scope_code)
         definition.id,
         definition.scope_code,
         definition.version_number,
         presentation.display_name,
         presentation.description,
         presentation.default_purpose
  from privacy.scope_definitions as definition
  join privacy.scope_presentations as presentation
    on presentation.scope_code = definition.scope_code
  where definition.status = 'published'
    and access_control.actor_kind() = 'person'
  order by definition.scope_code, definition.version_number desc
$function$;

alter function privacy.list_offerable_scopes() owner to allfit_owner;
revoke all on function privacy.list_offerable_scopes() from public;
grant execute on function privacy.list_offerable_scopes() to allfit_api;
