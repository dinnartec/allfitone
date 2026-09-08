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
}

export interface MovementQuery {
  personId: string
  discipline: string | null
  query: string | null
  limit: number
}

export interface MovementLibraryDatabase {
  readMovements(request: MovementQuery): Promise<Movement[]>
}
