import type {
  ProfessionalCatalogItem,
  ProfessionalCredential,
  ProfessionalCredentialWrite,
  ProfessionalProfilePut,
} from './studio-api.js'

export type ProfileField = 'headline' | 'bio' | 'practice_started_year' | 'specialty_codes'
export type ProfileErrors = Partial<Record<ProfileField, string>>
export type CredentialField =
  | 'credential_type_code'
  | 'issuer'
  | 'name'
  | 'identifier'
  | 'issued_on'
  | 'expires_on'
  | 'verification_url'
export type CredentialErrors = Partial<Record<CredentialField, string>>

export function validateProfile(
  value: ProfessionalProfilePut,
  publishedSpecialtyCodes: ReadonlySet<string>,
  currentYear = new Date().getUTCFullYear(),
): ProfileErrors {
  const errors: ProfileErrors = {}
  const headline = value.headline.trim()
  const bio = value.bio.trim()
  if (!headline) errors.headline = 'Escribe un titular profesional.'
  else if (headline.length > 120) errors.headline = 'Usa máximo 120 caracteres.'
  if (!bio) errors.bio = 'Cuenta brevemente cómo acompañas a tus clientes.'
  else if (bio.length > 2000) errors.bio = 'Usa máximo 2.000 caracteres.'
  if (
    !Number.isInteger(value.practice_started_year) ||
    value.practice_started_year < 1900 ||
    value.practice_started_year > currentYear
  ) {
    errors.practice_started_year = `El año debe estar entre 1900 y ${currentYear}.`
  }
  const uniqueCodes = new Set(value.specialty_codes)
  if (value.specialty_codes.length === 0) {
    errors.specialty_codes = 'Selecciona al menos una especialidad.'
  } else if (value.specialty_codes.length > 50) {
    errors.specialty_codes = 'Puedes seleccionar máximo 50 especialidades.'
  } else if (uniqueCodes.size !== value.specialty_codes.length) {
    errors.specialty_codes = 'No repitas especialidades.'
  } else if (value.specialty_codes.some((code) => !publishedSpecialtyCodes.has(code))) {
    errors.specialty_codes = 'Retira las especialidades que ya no están disponibles.'
  }
  return errors
}

export function validateCredential(
  value: ProfessionalCredentialWrite,
  publishedTypeCodes: ReadonlySet<string>,
): CredentialErrors {
  const errors: CredentialErrors = {}
  if (!publishedTypeCodes.has(value.credential_type_code)) {
    errors.credential_type_code = 'Selecciona un tipo de credencial disponible.'
  }
  if (!value.issuer.trim()) errors.issuer = 'Escribe quién emitió la credencial.'
  else if (value.issuer.trim().length > 200) errors.issuer = 'Usa máximo 200 caracteres.'
  if (!value.name.trim()) errors.name = 'Escribe el nombre de la credencial.'
  else if (value.name.trim().length > 200) errors.name = 'Usa máximo 200 caracteres.'
  if (value.identifier && value.identifier.trim().length > 160) {
    errors.identifier = 'Usa máximo 160 caracteres.'
  }
  if (value.issued_on && !isIsoDate(value.issued_on)) {
    errors.issued_on = 'Usa una fecha válida.'
  }
  if (value.expires_on && !isIsoDate(value.expires_on)) {
    errors.expires_on = 'Usa una fecha válida.'
  }
  if (value.issued_on && value.expires_on && value.expires_on < value.issued_on) {
    errors.expires_on = 'La vigencia no puede terminar antes de la emisión.'
  }
  if (value.verification_url && !isSafeHttpsUrl(value.verification_url)) {
    errors.verification_url = 'Usa una URL HTTPS válida, sin credenciales.'
  }
  return errors
}

export function hasErrors(errors: ProfileErrors | CredentialErrors): boolean {
  return Object.values(errors).some(Boolean)
}

export function mergeSpecialtyCatalog(
  published: readonly ProfessionalCatalogItem[],
  historical: readonly ProfessionalCatalogItem[],
): Array<ProfessionalCatalogItem & { available: boolean }> {
  const publishedCodes = new Set(published.map((item) => item.code))
  const historicalOnly = historical.filter((item) => !publishedCodes.has(item.code))
  return [
    ...published.map((item) => ({ ...item, available: true })),
    ...historicalOnly.map((item) => ({ ...item, available: false })),
  ]
}

export function groupCredentials(credentials: readonly ProfessionalCredential[]): {
  active: ProfessionalCredential[]
  retired: ProfessionalCredential[]
} {
  return {
    active: credentials.filter((credential) => credential.status === 'active'),
    retired: credentials.filter((credential) => credential.status === 'retired'),
  }
}

export function credentialStateLabel(credential: ProfessionalCredential): string {
  if (credential.status === 'retired') return 'Retirada'
  return {
    unverified: 'No verificada',
    verified: 'Verificada',
    expired: 'Verificación vencida',
    rejected: 'Verificación rechazada',
    unverifiable: 'No verificable',
    revoked: 'Verificación revocada',
  }[credential.verification.state]
}

export function credentialStateVariant(
  credential: ProfessionalCredential,
): 'success' | 'warning' | 'destructive' | 'outline' | 'info' {
  if (credential.status === 'retired') return 'outline'
  return {
    unverified: 'info',
    verified: 'success',
    expired: 'warning',
    rejected: 'destructive',
    unverifiable: 'warning',
    revoked: 'destructive',
  }[credential.verification.state] as 'success' | 'warning' | 'destructive' | 'outline' | 'info'
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isSafeHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
