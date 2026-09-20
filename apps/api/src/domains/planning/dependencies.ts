import { createStudioPlanningService, type StudioPlanningService } from './application/index.js'
import { createPlanningDatabase } from './infrastructure/index.js'
import { createSpacePlanningService, type SpacePlanningService } from './application/space.js'
import { createSpacePlanningDatabase } from './infrastructure/space.js'

/**
 * De dónde cuelgan las portadas, leído del entorno y nunca adivinado.
 *
 * Lanza cuando falta: un despliegue que arranca bien y sirve direcciones rotas es peor
 * que uno que no arranca. Es la misma regla que `catalog.movement_media` —la fila guarda
 * la clave y el origen vive en configuración (`ADR-031`)—, y es lo que deja cambiar de
 * CDN sin tocar una sola fila.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

let cached: StudioPlanningService | undefined

export function studioPlanningService(): StudioPlanningService {
  cached ??= createStudioPlanningService(createPlanningDatabase())
  return cached
}

let cachedSpace: SpacePlanningService | undefined

export function spacePlanningService(): SpacePlanningService {
  cachedSpace ??= createSpacePlanningService(
    createSpacePlanningDatabase(),
    required('CATALOG_MEDIA_BASE_URL'),
  )
  return cachedSpace
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpacePlanningService(service: SpacePlanningService | undefined): void {
  cachedSpace = service
}
