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
  expiresAt: Date
}): { subject: string; text: string; html: string } {
  const organization = escapeHtml(input.organizationName)
  const role = roleLabel(input.proposedRoleCode)
  const expires = input.expiresAt.toISOString().slice(0, 10)
  const url = escapeHtml(input.invitationUrl)
  return {
    subject: `Te invitaron al equipo de ${input.organizationName}`,
    text: [
      `${input.organizationName} te propuso unirte a su equipo como ${role}.`,
      'La invitación no crea una membresía hasta que la aceptes.',
      `Abrir invitación: ${input.invitationUrl}`,
      `Vence el ${expires}.`,
    ].join('\n\n'),
    html: `<div style="font-family:Arial,sans-serif;color:#071722;line-height:1.5"><h1 style="font-size:24px">Únete al equipo de ${organization}</h1><p>Te propusieron unirte como <strong>${role}</strong>.</p><p>La invitación no crea una membresía hasta que la aceptes.</p><p><a href="${url}" style="display:inline-block;background:#45d9e8;color:#071722;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Ver invitación</a></p><p style="font-size:13px;color:#49616c">Esta invitación vence el ${expires}.</p></div>`,
  }
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
