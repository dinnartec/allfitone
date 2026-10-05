/**
 * Presentation rules for published permission definitions.
 *
 * The vocabulary here is what a person will eventually be shown when they are
 * asked to grant something, so it is written for them and not for the schema. A
 * scope code is a database identifier; "Progreso corporal" is what a permission
 * is called.
 *
 * Criterion 3 — publishing a wider version does not widen what was already
 * granted — has no screen of its own, so the copy has to carry it. An operator
 * who thinks they are editing a permission will eventually widen one by accident;
 * one who knows they are publishing a new version that only applies from now on
 * will not.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ScopeDefinition = AllfitV1Schemas['ScopeDefinition']
export type ScopeResourceRule = AllfitV1Schemas['ScopeResourceRule']
export type ScopeCode = AllfitV1Schemas['ScopeCode']
export type AccessLevel = AllfitV1Schemas['AccessLevel']

export const SCOPE_CODES: readonly ScopeCode[] = [
  'relationship_training',
  'prior_training_history',
  'body_progress',
  'health_context',
  'nutrition_intake',
  'nutrition_guidance',
  'nutrition_media',
]

const SCOPE_LABELS: Record<ScopeCode, string> = {
  relationship_training: 'Entrenamiento de la relación',
  prior_training_history: 'Historial previo de entrenamiento',
  body_progress: 'Progreso corporal',
  health_context: 'Contexto de salud',
  nutrition_intake: 'Ingesta nutricional',
  nutrition_guidance: 'Guía nutricional',
  nutrition_media: 'Fotos y archivos de nutrición',
}

export function scopeLabel(code: ScopeCode): string {
  return SCOPE_LABELS[code]
}

export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'contribute']

const ACTION_LABELS: Record<AccessLevel, string> = {
  read: 'Sólo leer',
  contribute: 'Leer y aportar',
}

export function actionLabel(action: AccessLevel): string {
  return ACTION_LABELS[action]
}

export const DATA_CLASSIFICATIONS: readonly string[] = [
  'operational',
  'audit',
  'identity_pii',
  'training',
  'body',
  'nutrition',
  'health',
]

const CLASSIFICATION_LABELS: Record<string, string> = {
  operational: 'Operativo',
  audit: 'Auditoría',
  identity_pii: 'Identidad',
  training: 'Entrenamiento',
  body: 'Cuerpo',
  nutrition: 'Nutrición',
  health: 'Salud',
}

export function classificationLabel(code: string): string {
  return CLASSIFICATION_LABELS[code] ?? code
}

export interface RuleDraft {
  resource: string
  field: string
  classification: string
  action: AccessLevel
  excluded: boolean
  historical: boolean
}

export function emptyRule(): RuleDraft {
  return {
    resource: '',
    field: '',
    classification: 'operational',
    action: 'read',
    excluded: false,
    historical: false,
  }
}

const RESOURCE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const FIELD = /^[a-z][a-z0-9_]{0,63}$/

export type RuleIssue =
  'resource-shape' | 'field-shape' | 'historical-on-excluded' | 'historical-needs-read'

export function ruleIssue(draft: RuleDraft): RuleIssue | undefined {
  if (!RESOURCE.test(draft.resource.trim())) return 'resource-shape'
  const field = draft.field.trim()
  if (field !== '*' && !FIELD.test(field)) return 'field-shape'
  if (draft.historical && draft.excluded) return 'historical-on-excluded'
  if (draft.historical && draft.action !== 'read') return 'historical-needs-read'
  return undefined
}

const RULE_MESSAGES: Record<RuleIssue, string> = {
  'resource-shape':
    'El recurso va en minúsculas, separado por puntos: execution.body_measurements.',
  'field-shape': 'El campo va en minúsculas, o «*» para todos los campos del recurso.',
  'historical-on-excluded': 'Un campo excluido no puede leerse hacia atrás: está excluido.',
  'historical-needs-read': 'Leer hacia atrás sólo aplica a un campo de sólo lectura.',
}

export function ruleIssueMessage(issue: RuleIssue): string {
  return RULE_MESSAGES[issue]
}

/**
 * A version made only of exclusions grants nothing while looking like a
 * permission. The server refuses it; this says so before the request travels.
 */
export function includesSomething(drafts: readonly RuleDraft[]): boolean {
  return drafts.some((draft) => !draft.excluded)
}

/**
 * The rules of a permission, pasted instead of typed.
 *
 * `relationship_training` has twenty rules of five columns each. Typing a hundred
 * fields into a form whose result is **immutable forever** is how a misspelled
 * `planning.planned_sets` ends up frozen granting nothing, looking published. So the
 * list can be pasted — and then reviewed row by row in the same form, because the
 * operator is still the one publishing it.
 *
 * It refuses anything it does not fully understand, including a key it does not know.
 * Silently ignoring `historical_readible` would reintroduce exactly the mistake this
 * exists to prevent, and quietly rather than loudly.
 */
const RULE_KEYS = new Set([
  'resource',
  'field',
  'data_classification_code',
  'max_action',
  'is_excluded',
  'historical_readable',
])

export function parseRuleDrafts(text: string): { drafts: RuleDraft[] } | { issue: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { issue: 'Eso no es JSON válido.' }
  }
  if (!Array.isArray(parsed)) return { issue: 'Se espera una lista de reglas, entre corchetes.' }
  if (parsed.length === 0) return { issue: 'La lista no trae ninguna regla.' }

  const drafts: RuleDraft[] = []
  for (const [index, entry] of parsed.entries()) {
    const at = index + 1
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { issue: `La regla ${at} no es un objeto.` }
    }
    const rule = entry as Record<string, unknown>
    const unknownKey = Object.keys(rule).find((key) => !RULE_KEYS.has(key))
    if (unknownKey) {
      return { issue: `La regla ${at} trae una llave que no existe: ${unknownKey}.` }
    }
    if (typeof rule.resource !== 'string' || rule.resource.trim() === '') {
      return { issue: `La regla ${at} no dice sobre qué recurso aplica.` }
    }
    if (typeof rule.field !== 'string' || rule.field.trim() === '') {
      return { issue: `La regla ${at} no dice sobre qué campo aplica.` }
    }
    const classification = rule.data_classification_code
    if (typeof classification !== 'string' || !DATA_CLASSIFICATIONS.includes(classification)) {
      return {
        issue: `La regla ${at} clasifica el dato como «${String(classification)}», que no existe.`,
      }
    }
    const action = rule.max_action
    if (typeof action !== 'string' || !ACCESS_LEVELS.includes(action as AccessLevel)) {
      return { issue: `La regla ${at} pide el nivel «${String(action)}», que no existe.` }
    }
    for (const flag of ['is_excluded', 'historical_readable'] as const) {
      if (rule[flag] !== undefined && typeof rule[flag] !== 'boolean') {
        return { issue: `La regla ${at} usa «${flag}» con algo que no es sí o no.` }
      }
    }
    drafts.push({
      resource: rule.resource.trim(),
      field: rule.field.trim(),
      classification,
      action: action as AccessLevel,
      excluded: rule.is_excluded === true,
      historical: rule.historical_readable === true,
    })
  }
  return { drafts }
}

export function toResourceRules(drafts: readonly RuleDraft[]): ScopeResourceRule[] {
  return drafts.map((draft) => ({
    resource: draft.resource.trim(),
    field: draft.field.trim(),
    data_classification_code: draft.classification,
    max_action: draft.action,
    is_excluded: draft.excluded,
    historical_readable: draft.historical,
  }))
}

export function includedRules(definition: ScopeDefinition): ScopeResourceRule[] {
  return definition.rules.filter((rule) => !rule.is_excluded)
}

export function excludedRules(definition: ScopeDefinition): ScopeResourceRule[] {
  return definition.rules.filter((rule) => rule.is_excluded)
}

/**
 * Versions of one scope, newest first. The history is the point: an older version
 * is not obsolete, it is what somebody is still living under.
 */
export interface ScopeHistory {
  code: ScopeCode
  label: string
  versions: ScopeDefinition[]
}

export function groupByScope(definitions: readonly ScopeDefinition[]): ScopeHistory[] {
  const groups = new Map<ScopeCode, ScopeHistory>()
  for (const definition of definitions) {
    const code = definition.scope_code
    const group = groups.get(code) ?? { code, label: scopeLabel(code), versions: [] }
    group.versions.push(definition)
    groups.set(code, group)
  }
  for (const group of groups.values()) {
    group.versions.sort((left, right) => right.version_number - left.version_number)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function effectiveVersion(history: ScopeHistory): ScopeDefinition | undefined {
  return history.versions[0]
}

/**
 * What the operator is told when the server refuses. `conflict` is the
 * immutability guard, and the answer is never to retry: it is to publish the next
 * version.
 */
export function scopeDefinitionMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber de curaduría del catálogo. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    conflict:
      'Una versión publicada es inmutable. Para corregirla, publica la versión siguiente: quien ya aceptó la anterior la conserva.',
    'validation-failed':
      'La versión no cumple el contrato: revisa los recursos, los campos y que al menos uno esté incluido.',
    'invalid-request': 'Falta un identificador de comando. Vuelve a intentarlo.',
    'idempotency-in-progress': 'El comando anterior sigue procesándose. Reintenta en un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo publicar la definición de permiso.'
}
