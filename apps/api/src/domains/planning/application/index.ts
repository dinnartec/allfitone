import type { StudioActor } from '../../identity/index.js'
import type { PlanningDatabase } from '../domain/index.js'

export class StudioPlanningError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioPlanningError'
  }
}

export interface StudioPlanningService {
  createSessionTemplate: PlanningDatabase['createSessionTemplate'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  replaceSessionTemplateDraft: PlanningDatabase['replaceSessionTemplateDraft'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  publishSessionTemplateVersion: PlanningDatabase['publishSessionTemplateVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  deriveSessionTemplateVersion: PlanningDatabase['deriveSessionTemplateVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  deprecateSessionTemplateVersion: PlanningDatabase['deprecateSessionTemplateVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  createProgram: PlanningDatabase['createProgram'] extends (input: infer I) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  replaceProgramDraft: PlanningDatabase['replaceProgramDraft'] extends (input: infer I) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  publishProgramVersion: PlanningDatabase['publishProgramVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  deprecateProgramVersion: PlanningDatabase['deprecateProgramVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  listSessionTemplates: PlanningDatabase['listSessionTemplates'] extends (input: infer I) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  listPrograms: PlanningDatabase['listPrograms'] extends (input: infer I) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
  readSessionTemplateVersion: PlanningDatabase['readSessionTemplateVersion'] extends (
    input: infer I,
  ) => infer R
    ? (actor: StudioActor, input: Omit<I, 'personId'>) => R
    : never
}

export function createStudioPlanningService(database: PlanningDatabase): StudioPlanningService {
  const personId = (actor: StudioActor): string => {
    if (!actor.personId) throw new StudioPlanningError('registration-incomplete')
    return actor.personId
  }
  return {
    createSessionTemplate: (actor, input) =>
      database.createSessionTemplate({ personId: personId(actor), ...input }),
    replaceSessionTemplateDraft: (actor, input) =>
      database.replaceSessionTemplateDraft({ personId: personId(actor), ...input }),
    publishSessionTemplateVersion: (actor, input) =>
      database.publishSessionTemplateVersion({ personId: personId(actor), ...input }),
    deriveSessionTemplateVersion: (actor, input) =>
      database.deriveSessionTemplateVersion({ personId: personId(actor), ...input }),
    deprecateSessionTemplateVersion: (actor, input) =>
      database.deprecateSessionTemplateVersion({ personId: personId(actor), ...input }),
    createProgram: (actor, input) =>
      database.createProgram({ personId: personId(actor), ...input }),
    replaceProgramDraft: (actor, input) =>
      database.replaceProgramDraft({ personId: personId(actor), ...input }),
    publishProgramVersion: (actor, input) =>
      database.publishProgramVersion({ personId: personId(actor), ...input }),
    deprecateProgramVersion: (actor, input) =>
      database.deprecateProgramVersion({ personId: personId(actor), ...input }),
    listSessionTemplates: (actor, input) =>
      database.listSessionTemplates({ personId: personId(actor), ...input }),
    listPrograms: (actor, input) => database.listPrograms({ personId: personId(actor), ...input }),
    readSessionTemplateVersion: (actor, input) =>
      database.readSessionTemplateVersion({ personId: personId(actor), ...input }),
  }
}
