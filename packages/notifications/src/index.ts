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
  const roleDisplay = role.toLocaleUpperCase('es-CO')
  const expires = formatInvitationExpiry(input.expiresAt)
  const url = escapeHtml(input.invitationUrl)
  const brandAssetUrl = escapeHtml(input.brandAssetUrl)
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
    html: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light">
    <title>${organization} te invitó a su equipo en Allfit One</title>
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
      ${organization} te invitó como ${role}. Revisa la invitación antes del ${expires}.
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
                      <img src="${brandAssetUrl}" width="168" alt="Allfit One" style="display:block;width:168px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
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
                  INVITACIÓN DE EQUIPO
                </p>
                <h1 style="margin:0 0 16px;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:38px;font-weight:600;line-height:1.05;letter-spacing:-1px;color:#0A1B22;">
                  ${organization} quiere sumarte a su equipo
                </h1>
                <p style="margin:0 0 28px;font-family:'Manrope',Arial,sans-serif;font-size:16px;font-weight:400;line-height:1.6;color:#456069;">
                  Revisa el rol propuesto y la vigencia antes de decidir.
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
                    <td class="afo-detail" width="50%" valign="top" style="width:50%;padding:20px 22px 22px;">
                      <p style="margin:0 0 7px;font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:1.4px;color:#9DB4BC;">ROL PROPUESTO</p>
                      <p style="margin:0;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-size:26px;font-weight:600;line-height:1;color:#EAFFFF;">${roleDisplay}</p>
                    </td>
                    <td class="afo-detail afo-detail-expiry" width="50%" valign="top" style="width:50%;padding:20px 22px 22px;border-left:1px solid #456069;">
                      <p style="margin:0 0 7px;font-family:'Manrope',Arial,sans-serif;font-size:11px;font-weight:700;line-height:1.25;letter-spacing:1.4px;color:#9DB4BC;">VÁLIDA HASTA</p>
                      <p style="margin:0;font-family:'Manrope',Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.35;color:#EAFFFF;">${expires}</p>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-collapse:separate;">
                  <tr>
                    <td align="center" bgcolor="#55EFFB" style="background-color:#55EFFB;border-radius:999px;">
                      <a href="${url}" target="_blank" style="display:inline-block;padding:15px 26px;font-family:'Manrope',Arial,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;color:#06282B;border:1px solid #55EFFB;border-radius:999px;">Revisar invitación</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:22px 0 0;font-family:'Manrope',Arial,sans-serif;font-size:13px;font-weight:400;line-height:1.55;color:#536A73;">
                  Aceptar crea tu membresía. Abrir este correo o revisar la invitación no lo hace.
                </p>
              </td>
            </tr>
            <tr>
              <td class="afo-footer" bgcolor="#F2FAFA" style="padding:24px 40px;background-color:#F2FAFA;border-top:1px solid #E0EDED;">
                <p style="margin:0 0 8px;font-family:'Manrope',Arial,sans-serif;font-size:13px;font-weight:600;line-height:1.5;color:#456069;">
                  ¿No esperabas esta invitación?
                </p>
                <p style="margin:0;font-family:'Manrope',Arial,sans-serif;font-size:12px;font-weight:400;line-height:1.6;color:#536A73;">
                  Puedes ignorar este correo; no se hará ningún cambio. Allfit One lo envió en nombre de ${organization}.
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
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
