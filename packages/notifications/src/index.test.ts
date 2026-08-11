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

test('renders an invitation without claiming that an account already exists', () => {
  const rendered = renderTeamInvitationEmail({
    organizationName: 'Studio Norte',
    proposedRoleCode: 'staff',
    invitationUrl: 'https://space.allfit.one/invitations/token',
    expiresAt: new Date('2026-08-18T12:00:00.000Z'),
  })
  expect(rendered.subject).toContain('Studio Norte')
  expect(rendered.text).not.toContain('tu cuenta')
  expect(rendered.html).toContain('https://space.allfit.one/invitations/token')
})
