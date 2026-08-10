export interface ProfessionalCatalogItem {
  code: string
  name: string
  description: string | null
}

export interface ProfessionalCatalogDatabase {
  listSpecialties(personId: string): Promise<ProfessionalCatalogItem[]>
  listCredentialTypes(personId: string): Promise<ProfessionalCatalogItem[]>
}
