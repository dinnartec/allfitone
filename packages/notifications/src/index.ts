import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class NotificationDeliveryError extends Error {
  constructor(
    readonly code:
      'network_error' | 'provider_throttled' | 'provider_unavailable' | 'provider_rejected',
    readonly retryable: boolean,
  ) {
    super(code)
    this.name = 'NotificationDeliveryError'
  }
}

export function createInvitationToken(invitationId: string, encodedKey: string): string {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('Invitation token keys must decode to exactly 32 bytes')
  return createHmac('sha256', key)
    .update(`allfit.staff-invitation.v1\u0000${invitationId}`, 'utf8')
    .digest('base64url')
}

export function hashInvitationToken(token: string): Uint8Array {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function invitationTokenKey(version: number, environment = process.env): string {
  if (!Number.isSafeInteger(version) || version <= 0)
    throw new Error('Invalid invitation key version')
  const value = environment[`INVITATION_TOKEN_KEY_V${version}`]
  if (!value) throw new Error(`INVITATION_TOKEN_KEY_V${version} is not set`)
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error(`INVITATION_TOKEN_KEY_V${version} must decode to 32 bytes`)
  return value
}

export function activeInvitationTokenKeyVersion(environment = process.env): number {
  const value = Number(environment.INVITATION_TOKEN_ACTIVE_VERSION)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('INVITATION_TOKEN_ACTIVE_VERSION must be a positive integer')
  }
  invitationTokenKey(value, environment)
  return value
}

export function constantTimeBearerMatches(
  authorization: string | undefined,
  secret: string,
): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const actual = Buffer.from(authorization ?? '', 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function createResendEmailSender(
  config: { apiKey: string; from: string },
  fetcher: FetchLike = fetch,
): EmailSender {
  if (!config.apiKey || !config.from) throw new Error('Resend email configuration is incomplete')
  return {
    async send(message) {
      let response: Response
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': message.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        })
      } catch {
        throw new NotificationDeliveryError('network_error', true)
      }
      if (response.ok) return
      if (response.status === 429) {
        throw new NotificationDeliveryError('provider_throttled', true)
      }
      if (response.status >= 500) {
        throw new NotificationDeliveryError('provider_unavailable', true)
      }
      throw new NotificationDeliveryError('provider_rejected', false)
    },
  }
}

export function renderTeamInvitationEmail(input: {
  organizationName: string
  proposedRoleCode: 'admin' | 'coach' | 'staff'
  invitationUrl: string
  brandAssetUrl: string
  expiresAt: Date
}): { subject: string; text: string; html: string } {
  const organization = escapeHtml(input.organizationName)
  const role = roleLabel(input.proposedRoleCode)
  const expires = formatInvitationExpiry(input.expiresAt)
  return {
    subject: `${input.organizationName} te invitó a su equipo en Allfit One`,
    text: [
      `${input.organizationName} quiere sumarte a su equipo en Allfit One.`,
      `Rol propuesto: ${role}`,
      `Válida hasta: ${expires}`,
      `Revisar invitación: ${input.invitationUrl}`,
      'Aceptar crea tu membresía. Abrir este correo o revisar la invitación no lo hace.',
      'Si no esperabas esta invitación, puedes ignorar este correo.',
    ].join('\n\n'),
    html: invitationEmailHtml({
      title: `${organization} te invitó a su equipo en Allfit One`,
      preheader: `${organization} te invitó como ${role}. Revisa la invitación antes del ${expires}.`,
      eyebrow: 'INVITACIÓN DE EQUIPO',
      heading: `${organization} quiere sumarte a su equipo`,
      lead: 'Revisa el rol propuesto y la vigencia antes de decidir.',
      detailLabel: 'ROL PROPUESTO',
      detailValue: role.toLocaleUpperCase('es-CO'),
      expires,
      actionUrl: escapeHtml(input.invitationUrl),
      brandAssetUrl: escapeHtml(input.brandAssetUrl),
      note: 'Aceptar crea tu membresía. Abrir este correo o revisar la invitación no lo hace.',
      footer: `Puedes ignorar este correo; no se hará ningún cambio. Allfit One lo envió en nombre de ${organization}.`,
    }),
  }
}

/**
 * The email that hands an organization Allfit created to its owner (`HU-BO-014`).
 *
 * It says, before anything else, that the organization does not operate until it is
 * accepted: the recipient is being offered ownership, not told they already have it.
 * Nobody from the organization sent it, so it never claims to speak in its name.
 */
export function renderOwnershipInvitationEmail(input: {
  organizationName: string
  invitationUrl: string
  brandAssetUrl: string
  expiresAt: Date
}): { subject: string; text: string; html: string } {
  const organization = escapeHtml(input.organizationName)
  const expires = formatInvitationExpiry(input.expiresAt)
  return {
    subject: `${input.organizationName} te espera en Allfit One`,
    text: [
      `Allfit preparó ${input.organizationName} en Allfit One para que la recibas como propietario.`,
      'Mientras no la aceptes, la organización existe pero no opera.',
      `Válida hasta: ${expires}`,
      `Revisar invitación: ${input.invitationUrl}`,
      'Aceptar te hace su propietario. Abrir este correo o revisar la invitación no lo hace.',
      'Si no esperabas esta invitación, puedes ignorar este correo.',
    ].join('\n\n'),
    html: invitationEmailHtml({
      title: `${organization} te espera en Allfit One`,
      preheader: `Allfit preparó ${organization} para ti. Revisa la invitación antes del ${expires}.`,
      eyebrow: 'ENTREGA DE ORGANIZACIÓN',
      heading: `${organization} está lista para que la recibas`,
      lead: 'Allfit la preparó para ti. Mientras no la aceptes, la organización existe pero no opera.',
      detailLabel: 'ORGANIZACIÓN',
      detailValue: organization,
      expires,
      actionUrl: escapeHtml(input.invitationUrl),
      brandAssetUrl: escapeHtml(input.brandAssetUrl),
      note: 'Aceptar te hace su propietario. Abrir este correo o revisar la invitación no lo hace.',
      footer:
        'Puedes ignorar este correo; no se hará ningún cambio. Allfit One lo envió porque el equipo de Allfit preparó esta organización para esta dirección.',
    }),
  }
}

/**
 * Every value arrives already escaped: the caller knows which parts came from a
 * person.
 *
 * `expires` and the action are optional because not every message is an
 * invitation. A notice that something already happened has no deadline and
 * nothing to click, and giving it a fake one of either would be inventing data
 * to fit a template.
 */
interface InvitationEmailParts {
  title: string
  preheader: string
  eyebrow: string
  heading: string
  lead: string
  detailLabel: string
  detailValue: string
  expiryLabel?: string
  expires?: string
  actionLabel?: string
  actionUrl?: string
  brandAssetUrl: string
  note: string
  footer: string
}

/**
 * Telling somebody that a different professional now attends them.
 *
 * It carries no link and no deadline. There is nothing for the person to
 * approve — the change already happened — and a button in an email about who
 * can reach their data is an invitation to phish them. What they can do is talk
 * to their gym, which the text says.
 *
 * It also says what did **not** change, because that is the question this email
 * raises: their permissions are untouched, and the new professional sees
 * exactly what the previous one did, which is whatever they allowed.
 */
export function renderProfessionalReassignedEmail(input: {
  organizationName: string
  professionalName: string
  previousProfessionalName: string
  brandAssetUrl: string
}): { subject: string; text: string; html: string } {
  const organization = escapeHtml(input.organizationName)
  const professional = escapeHtml(input.professionalName)
  const previous = escapeHtml(input.previousProfessionalName)
  return {
    subject: `${input.professionalName} es ahora tu profesional en ${input.organizationName}`,
    text: [
      `${input.organizationName} cambió el profesional que te atiende.`,
      `Antes: ${input.previousProfessionalName}`,
      `Ahora: ${input.professionalName}`,
      'Tus permisos no cambiaron. Tu nuevo profesional ve exactamente lo que el anterior veía, que es lo que tú permitiste, y nada más.',
      `${input.previousProfessionalName} ya no tiene acceso a tu información.`,
      'Puedes cambiar o retirar tus permisos cuando quieras desde la app. Si no esperabas este cambio, habla con tu gimnasio.',
    ].join('\n\n'),
    html: invitationEmailHtml({
      title: `${professional} es ahora tu profesional en ${organization}`,
      preheader: `${organization} cambió quién te atiende. Tus permisos no cambiaron.`,
      eyebrow: 'CAMBIO DE PROFESIONAL',
      heading: `${organization} cambió el profesional que te atiende`,
      lead: `${previous} ya no tiene acceso a tu información. Tus permisos no cambiaron: tu nuevo profesional ve exactamente lo que el anterior veía.`,
      detailLabel: 'AHORA TE ATIENDE',
      detailValue: professional,
      brandAssetUrl: escapeHtml(input.brandAssetUrl),
      note: 'Puedes cambiar o retirar tus permisos cuando quieras desde la app. Si no esperabas este cambio, habla con tu gimnasio.',
      footer: 'Allfit One',
    }),
  }
}

function invitationEmailHtml(parts: InvitationEmailParts): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light">
    <title>${parts.title}</title>
    <style>
      :root { color-scheme: light only; supported-color-schemes: light; }
      body { margin: 0; padding: 0; width: 100% !important; background: #EDF6F6; }
      table { border-spacing: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      a { color: inherit; }
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      @media only screen and (max-width: 620px) {
        .afo-shell { padding: 16px 8px !important; }
        .afo-content { padding: 28px 22px 30px !important; }
        .afo-brand { padding: 20px 22px !important; }
        .afo-footer { padding: 22px !important; }
        .afo-detail { display: block !important; width: 100% !important; box-sizing: border-box; }
        .afo-detail-expiry { border-left: 0 !important; border-top: 1px solid #456069 !important; padding-left: 22px !important; padding-top: 18px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#EDF6F6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      ${parts.preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EDF6F6" style="width:100%;background-color:#EDF6F6;border-collapse:collapse;">
      <tr>
        <td class="afo-shell" align="center" style="padding:32px 16px;">
          <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E0EDED;border-radius:20px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td height="6" bgcolor="#55EFFB" style="height:6px;background-color:#55EFFB;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td class="afo-brand" style="padding:22px 40px;border-bottom:1px solid #E0EDED;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td>
                      <img src="${parts.brandAssetUrl}" width="168" alt="Allfit One" style="display:block;width:168px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
                    </td>
                    <td align="right" style="font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:1.5px;color:#536A73;">
                      STUDIO
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="afo-content" style="padding:38px 40px 40px;">
                <p style="margin:0 0 10px;font-family:'Manrope',Arial,sans-serif;font-size:12px;font-weight:700;line-height:1.25;letter-spacing:2px;color:#176D72;">
                  ${parts.eyebrow}
                </p>
                <h1 style="margin:0 0 16px;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:38px;font-weight:600;line-height:1.05;letter-spacing:-1px;color:#0A1B22;">
                  ${parts.heading}
                </h1>
                <p style="margin:0 0 28px;font-family:'Manrope',Arial,sans-serif;font-size:16px;font-weight:400;line-height:1.6;color:#456069;">
                  ${parts.lead}
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#030713" style="width:100%;background-color:#030713;border-left:6px solid #55EFFB;border-radius:12px;border-collapse:separate;">
                  <tr>
                    <td colspan="2" style="padding:20px 22px 16px;font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:2px;color:#9DB4BC;">
                      INVITACIÓN
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" height="1" bgcolor="#16242F" style="height:1px;background-color:#16242F;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td class="afo-detail" width="${parts.expires ? '50%' : '100%'}" valign="top" style="width:${parts.expires ? '50%' : '100%'};padding:20px 22px 22px;"${parts.expires ? '' : ' colspan="2"'}>
                      <p style="margin:0 0 7px;font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:1.4px;color:#9DB4BC;">${parts.detailLabel}</p>
                      <p style="margin:0;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:26px;font-weight:600;line-height:1;color:#EAFFFF;">${parts.detailValue}</p>
                    </td>${
                      parts.expires
                        ? `
                    <td class="afo-detail afo-detail-expiry" width="50%" valign="top" style="width:50%;padding:20px 22px 22px;border-left:1px solid #456069;">
                      <p style="margin:0 0 7px;font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:1.4px;color:#9DB4BC;">${parts.expiryLabel ?? 'VÁLIDA HASTA'}</p>
                      <p style="margin:0;font-family:'Manrope',Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.35;color:#EAFFFF;">${parts.expires}</p>
                    </td>`
                        : ''
                    }
                  </tr>
                </table>
${
  parts.actionUrl
    ? `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-collapse:separate;">
                  <tr>
                    <td align="center" bgcolor="#55EFFB" style="background-color:#55EFFB;border-radius:999px;">
                      <a href="${parts.actionUrl}" target="_blank" style="display:inline-block;padding:15px 26px;font-family:'Manrope',Arial,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;color:#06282B;border:1px solid #55EFFB;border-radius:999px;">${parts.actionLabel ?? 'Revisar invitación'}</a>
                    </td>
                  </tr>
                </table>`
    : ''
}

                <p style="margin:22px 0 0;font-family:'Manrope',Arial,sans-serif;font-size:13px;font-weight:400;line-height:1.55;color:#536A73;">
                  ${parts.note}
                </p>
              </td>
            </tr>
            <tr>
              <td class="afo-footer" bgcolor="#F2FAFA" style="padding:24px 40px;background-color:#F2FAFA;border-top:1px solid #E0EDED;">
                <p style="margin:0 0 8px;font-family:'Manrope',Arial,sans-serif;font-size:13px;font-weight:600;line-height:1.5;color:#456069;">
                  ¿No esperabas esta invitación?
                </p>
                <p style="margin:0;font-family:'Manrope',Arial,sans-serif;font-size:12px;font-weight:400;line-height:1.6;color:#536A73;">
                  ${parts.footer}
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function formatInvitationExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(expiresAt)
}

function roleLabel(role: 'admin' | 'coach' | 'staff'): string {
  return role === 'admin' ? 'administrador' : role === 'coach' ? 'coach' : 'staff'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
