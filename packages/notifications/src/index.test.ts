import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  NotificationDeliveryError,
  createInvitationToken,
  createResendEmailSender,
  hashInvitationToken,
  renderTeamInvitationEmail,
} from './index.js'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('team invitation tokens', () => {
  test('derives a stable secret without storing it', () => {
    const first = createInvitationToken('0199b000-0000-7000-8000-000000000031', KEY)
    const second = createInvitationToken('0199b000-0000-7000-8000-000000000031', KEY)
    expect(first).toBe(second)
    expect(hashInvitationToken(first)).toEqual(createHash('sha256').update(first).digest())
  })

  test('rejects keys that are not exactly 32 bytes', () => {
    expect(() => createInvitationToken('0199b000-0000-7000-8000-000000000031', 'eA==')).toThrow()
  })
})

describe('Resend adapter', () => {
  test('sends the closed email shape with provider idempotency', async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined
    const sender = createResendEmailSender(
      { apiKey: 're_test', from: 'Allfit One <team@example.test>' },
      async (input, init) => {
        captured = { url: String(input), init }
        return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 })
      },
    )
    await sender.send({
      to: 'recipient@example.test',
      subject: 'Invitación',
      text: 'Texto',
      html: '<p>Texto</p>',
      idempotencyKey: 'staff-invitation/event-123',
    })
    expect(captured?.url).toBe('https://api.resend.com/emails')
    expect(new Headers(captured?.init?.headers).get('idempotency-key')).toBe(
      'staff-invitation/event-123',
    )
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      from: 'Allfit One <team@example.test>',
      to: ['recipient@example.test'],
    })
  })

  test('classifies provider throttling as retryable without exposing response bodies', async () => {
    const sender = createResendEmailSender(
      { apiKey: 're_test', from: 'team@example.test' },
      async () => new Response('provider details', { status: 429 }),
    )
    await expect(
      sender.send({
        to: 'recipient@example.test',
        subject: 'Invitación',
        text: 'Texto',
        html: '<p>Texto</p>',
        idempotencyKey: 'staff-invitation/event-123',
      }),
    ).rejects.toEqual(new NotificationDeliveryError('provider_throttled', true))
  })
})

describe('team invitation email', () => {
  test('renders a branded, email-safe invitation with the decision details up front', () => {
    const rendered = renderTeamInvitationEmail({
      organizationName: 'Studio Norte',
      proposedRoleCode: 'staff',
      invitationUrl: 'https://studio.allfit.one/invitations#token=staff-token',
      brandAssetUrl: 'https://studio.allfit.one/email/allfit-one-lockup-on-light.png',
      expiresAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    expect(rendered.subject).toBe('Studio Norte te invitó a su equipo en Allfit One')
    expect(rendered.text).toContain('Rol propuesto: staff')
    expect(rendered.text).toContain('Válida hasta: 18 de agosto de 2026')
    expect(rendered.text).not.toContain('tu cuenta')
    expect(rendered.html).toStartWith('<!doctype html>')
    expect(rendered.html).toContain('role="presentation"')
    expect(rendered.html).toContain('max-width:600px')
    expect(rendered.html).toContain('ROL PROPUESTO')
    expect(rendered.html).toContain('VÁLIDA HASTA')
    expect(rendered.html).toContain('Revisar invitación')
    expect(rendered.html).toContain('https://studio.allfit.one/invitations#token=staff-token')
    expect(rendered.html).toContain(
      '<img src="https://studio.allfit.one/email/allfit-one-lockup-on-light.png"',
    )
    expect(rendered.html).toContain('alt="Allfit One"')
    expect(rendered.html).not.toContain('ALLFIT <span')
  })

  test('uses the canonical light email palette and typography fallbacks from the design system', () => {
    const { html } = renderTeamInvitationEmail({
      organizationName: 'Allfit Gym',
      proposedRoleCode: 'coach',
      invitationUrl: 'https://studio.allfit.one/invitations#token=coach-token',
      brandAssetUrl: 'https://studio.allfit.one/email/allfit-one-lockup-on-light.png',
      expiresAt: new Date('2026-08-19T12:00:00.000Z'),
    })

    expect(html).toContain('#EDF6F6')
    expect(html).toContain('#FFFFFF')
    expect(html).toContain('#030713')
    expect(html).toContain('#55EFFB')
    expect(html).toContain("'Barlow Condensed','Arial Narrow',Arial,sans-serif")
    expect(html).toContain("'Manrope',Arial,sans-serif")
  })

  test('escapes organization and URL content in every HTML context', () => {
    const { html } = renderTeamInvitationEmail({
      organizationName: '<North & South>',
      proposedRoleCode: 'admin',
      invitationUrl: 'https://studio.allfit.one/invitations?next=one&source="email"',
      brandAssetUrl: 'https://studio.allfit.one/email/lockup.png?source="email"&mode=light',
      expiresAt: new Date('2026-08-20T12:00:00.000Z'),
    })

    expect(html).toContain('&lt;North &amp; South&gt;')
    expect(html).not.toContain('<North & South>')
    expect(html).toContain('next=one&amp;source=&quot;email&quot;')
    expect(html).toContain('lockup.png?source=&quot;email&quot;&amp;mode=light')
  })
})
