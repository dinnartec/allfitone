/**
 * `HU-BO-005` — presentation rules for what needs attention.
 *
 * Three statements must never be confused on this screen, because each leads to
 * a different decision. **Nothing pending** is a count of zero. **Withheld** means
 * the operator's duties do not resolve that notice, so the database did not count
 * it for them — it says nothing about whether something is pending. **Not
 * modelled** means Allfit has no table for it yet. A withheld or unmodelled notice
 * that rendered as zero would tell an operator to relax about something nobody
 * looked at.
 *
 * Every notice leads to the screen where it is resolved, and that screen checks
 * its own duty again. A counter here opens nothing.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type SupportAttentionPanel = AllfitV1Schemas['SupportAttentionPanel']
export type AttentionVerificationNotice = AllfitV1Schemas['AttentionVerificationNotice']
export type AttentionUnclaimedOrganizationNotice =
  AllfitV1Schemas['AttentionUnclaimedOrganizationNotice']
export type AttentionFailureNotice = AllfitV1Schemas['AttentionFailureNotice']
export type AttentionFailureGroup = AllfitV1Schemas['AttentionFailureGroup']

export const ATTENTION_DESTINATIONS = {
  verifications: '/verifications',
  unclaimedOrganizations: '/organizations?status=unclaimed',
  failures: '/diagnosis',
} as const

export const WITHHELD_NOTE =
  'Tus deberes vigentes no resuelven este aviso, así que no se cuenta para ti. No significa que no haya nada pendiente.'

export const BILLING_NOTE =
  'Allfit todavía no guarda cobros ni suscripciones. Cuando existan, aquí se verán los cobros fallidos recientes y las suscripciones suspendidas.'

function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

export function verificationSummary(notice: AttentionVerificationNotice): string {
  if (notice.availability === 'withheld') return WITHHELD_NOTE
  const pending = notice.pending_count ?? 0
  const renewals = notice.renewals_due_count ?? 0
  const waiting =
    pending === 0
      ? 'Ningún título espera revisión'
      : counted(pending, 'título espera revisión', 'títulos esperan revisión')
  const lapsing =
    renewals === 0
      ? 'ninguna verificación vence pronto sin renovación abierta'
      : counted(
          renewals,
          'verificación vence en menos de 30 días sin renovación abierta',
          'verificaciones vencen en menos de 30 días sin renovación abierta',
        )
  return `${waiting}, y ${lapsing}.`
}

export function unclaimedSummary(notice: AttentionUnclaimedOrganizationNotice): string {
  if (notice.availability === 'withheld') return WITHHELD_NOTE
  const count = notice.count ?? 0
  if (count === 0) return 'Todos los gimnasios que Allfit creó ya tienen dueño.'
  const followUp = notice.needs_follow_up_count ?? 0
  const gyms = counted(count, 'gimnasio sin reclamar', 'gimnasios sin reclamar')
  if (followUp === 0) return `${gyms}, todos con la invitación a su dueño vigente.`
  return `${gyms}. ${counted(
    followUp,
    'necesita seguimiento: su invitación venció, fue rechazada o nunca salió.',
    'necesitan seguimiento: su invitación venció, fue rechazada o nunca salió.',
  )}`
}

export function failureSummary(notice: AttentionFailureNotice): string {
  if (notice.availability === 'withheld') return WITHHELD_NOTE
  const groups = notice.groups?.length ?? 0
  const circuits = notice.open_circuits?.length ?? 0
  if (groups === 0 && circuits === 0) {
    return `Nada se está repitiendo en las últimas ${notice.window_hours} horas.`
  }
  const parts: string[] = []
  if (groups > 0) {
    parts.push(
      counted(
        groups,
        'aviso o comando falla una y otra vez',
        'avisos o comandos fallan una y otra vez',
      ),
    )
  }
  if (circuits > 0) {
    parts.push(
      counted(
        circuits,
        'canal de entrega está interrumpido',
        'canales de entrega están interrumpidos',
      ),
    )
  }
  const more = notice.groups_truncated ? ' Se muestran los 20 que más fallan.' : ''
  return `${parts.join(', y ')} en las últimas ${notice.window_hours} horas.${more}`
}

/** Failed attempts and how many items they touched, never who. */
export function groupLine(group: AttentionFailureGroup): string {
  const items =
    group.source === 'notification'
      ? counted(group.affected, 'aviso', 'avisos')
      : counted(group.affected, 'comando', 'comandos')
  const what = group.source === 'notification' ? 'fallas' : 'atascos'
  return `${group.failures} ${what} en ${items}`
}

/** Whether a notice asks for somebody to act, which is what earns it a warning tone. */
export function needsAction(panel: SupportAttentionPanel): {
  verifications: boolean
  unclaimedOrganizations: boolean
  failures: boolean
} {
  const verifications = panel.credential_verifications
  const unclaimed = panel.unclaimed_organizations
  const failures = panel.repeated_failures
  return {
    verifications:
      (verifications.pending_count ?? 0) > 0 || (verifications.renewals_due_count ?? 0) > 0,
    unclaimedOrganizations: (unclaimed.needs_follow_up_count ?? 0) > 0,
    failures: (failures.groups?.length ?? 0) > 0 || (failures.open_circuits?.length ?? 0) > 0,
  }
}

export function attentionMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ninguno de tus deberes vigentes resuelve un aviso de este panel. El rol de administrador no basta por sí solo, y los deberes vencen por diseño: pide el del área que atiendes.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer lo que necesita atención.'
}
