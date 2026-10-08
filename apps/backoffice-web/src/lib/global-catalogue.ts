/**
 * `HU-BO-022` — presentation rules for curating the global catalogue.
 *
 * Two things this module refuses to blur. A code is not a name: the screen shows both,
 * because the code is what a template written last year still resolves against. And
 * archiving is not deleting: what depends on an entry is shown beside it, so nobody
 * archives a discipline without seeing what already uses it.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeGlobalCatalogue = AllfitV1Schemas['BackofficeGlobalCatalogue']
export type GlobalCatalogueEntry = AllfitV1Schemas['GlobalCatalogueEntry']
export type CatalogueEntryKind = GlobalCatalogueEntry['kind']
export type CatalogueEntryStatus = GlobalCatalogueEntry['status']

const CODE = /^[a-z][a-z0-9_]{1,63}$/
const MAX_NAME = 120

const STATUS_LABELS: Record<CatalogueEntryStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  deprecated: 'Deprecado',
  archived: 'Archivado',
}

export function catalogueStatusLabel(status: CatalogueEntryStatus): string {
  return STATUS_LABELS[status]
}

export type StatusTone = 'success' | 'warning' | 'secondary' | 'destructive'

export function catalogueStatusTone(status: CatalogueEntryStatus): StatusTone {
  if (status === 'published') return 'success'
  if (status === 'draft') return 'warning'
  return 'secondary'
}

const KIND_LABELS: Record<CatalogueEntryKind, string> = {
  discipline: 'Disciplina',
  activity_type: 'Tipo de actividad',
  movement: 'Movimiento',
}

export function catalogueKindLabel(kind: CatalogueEntryKind): string {
  return KIND_LABELS[kind]
}

export function isValidCatalogueCode(value: string): boolean {
  return CODE.test(value.trim())
}

export function isValidCatalogueName(value: string): boolean {
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_NAME
}

export function catalogueCodeIssue(): string {
  return 'El código va en minúsculas, sin espacios y sin tildes: letras, números y guion bajo.'
}

export function catalogueNameIssue(): string {
  return `El nombre no puede quedar vacío ni pasar de ${MAX_NAME} caracteres.`
}

/** What archiving this entry would withdraw from search, in words. */
export function inUseExplanation(entry: GlobalCatalogueEntry): string {
  if (entry.in_use_count === 0) return 'Nada lo usa todavía.'
  const noun = entry.in_use_count === 1 ? 'referencia' : 'referencias'
  return `${entry.in_use_count} ${noun}. Archivarlo lo retira de las búsquedas y esas siguen funcionando.`
}

export function publishedDisciplines(catalogue: BackofficeGlobalCatalogue): GlobalCatalogueEntry[] {
  return catalogue.disciplines.filter((entry) => entry.status === 'published')
}

export function catalogueOutcomeMessage(
  action: 'publish' | 'archive',
  entry: GlobalCatalogueEntry,
): string {
  const what = `${catalogueKindLabel(entry.kind).toLowerCase()} «${entry.name}»`
  if (action === 'publish') {
    return `Se publicó la ${what}. Ya está disponible para gimnasios y personas.`
  }
  return `Se archivó la ${what}. Sale de las búsquedas, y lo que ya la usaba sigue funcionando.`
}

export function globalCatalogueMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Publicar el catálogo global exige el deber de curaduría vigente. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer el catálogo global.'
}

export function catalogueCommandMessage(code: string): string {
  const messages: Record<string, string> = {
    conflict:
      'Ese código ya está publicado, ya nombra otra cosa, o la disciplina todavía tiene contenido publicado. Revisa la lista actualizada.',
    'not-found':
      'Eso no existe en el catálogo global. El contenido privado de un gimnasio no se cura desde aquí.',
    'validation-failed': 'El servidor rechazó el código o el nombre. Revisa su forma.',
    forbidden: globalCatalogueMessage('forbidden'),
    'idempotency-in-progress': 'La acción anterior todavía se está procesando. Espera un momento.',
    unauthenticated: globalCatalogueMessage('unauthenticated'),
    'network-unavailable': globalCatalogueMessage('network-unavailable'),
  }
  return messages[code] ?? 'No se pudo completar la acción.'
}

export function equipmentExplanation(
  availability: BackofficeGlobalCatalogue['equipment_availability'],
): string {
  if (availability === 'available') return 'El equipamiento se publica desde aquí.'
  return 'Allfit todavía no guarda equipamiento: no es que no haya, es que no existe dónde ponerlo. Publicarlo llega con su propia tabla.'
}
