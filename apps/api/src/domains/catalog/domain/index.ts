export interface ProfessionalCatalogItem {
  code: string
  name: string
  description: string | null
}

export interface ProfessionalCatalogDatabase {
  listSpecialties(personId: string): Promise<ProfessionalCatalogItem[]>
  listCredentialTypes(personId: string): Promise<ProfessionalCatalogItem[]>
}

export interface Movement {
  id: string
  discipline_code: string
  name: string
  muscles: string[]
  equipment: string[]
}

export interface CatalogueTerm {
  code: string
  name: string
}

export interface MuscleTerm extends CatalogueTerm {
  region: string
  body_slug: string | null
}

export interface MovementQuery {
  personId: string
  discipline: string | null
  query: string | null
  /** Several values are `or`; combining with `equipment` is `and`. */
  muscles: string[]
  equipment: string[]
  limit: number
}

export interface MovementLibraryDatabase {
  readMovements(request: MovementQuery): Promise<Movement[]>
  readEquipment(personId: string): Promise<CatalogueTerm[]>
  readMuscles(personId: string): Promise<MuscleTerm[]>
}
