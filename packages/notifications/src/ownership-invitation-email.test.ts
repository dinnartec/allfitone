import { describe, expect, test } from 'bun:test'

import { renderOwnershipInvitationEmail } from './index.js'

const INPUT = {
  organizationName: 'Handover Norte',
  invitationUrl: 'https://studio.allfit.one/invitations#token=ownership-token',
  brandAssetUrl: 'https://studio.allfit.one/email/allfit-one-lockup-on-light.png',
  expiresAt: new Date('2026-09-20T12:00:00.000Z'),
}

describe('ownership invitation email', () => {
  test('says the organization does not operate until it is accepted, in both versions', () => {
    const rendered = renderOwnershipInvitationEmail(INPUT)

    expect(rendered.subject).toBe('Handover Norte te espera en Allfit One')
    expect(rendered.text).toContain('existe pero no opera')
    expect(rendered.html).toContain('existe pero no opera')
    expect(rendered.text).toContain('Aceptar te hace su propietario')
    expect(rendered.html).toContain(INPUT.invitationUrl)
    expect(rendered.text).toContain('20 de septiembre de 2026')
  })

  test('never speaks in the name of an organization that has not been claimed', () => {
    const { html, text } = renderOwnershipInvitationEmail(INPUT)

    expect(html).not.toContain('en nombre de')
    expect(text).not.toContain('en nombre de')
    expect(html).toContain('el equipo de Allfit preparó esta organización')
  })

  test('escapes the organization name and the link in every HTML context', () => {
    const { html } = renderOwnershipInvitationEmail({
      ...INPUT,
      organizationName: '<North & "South">',
      invitationUrl: 'https://studio.allfit.one/invitations?next=one&source="email"',
    })

    expect(html).not.toContain('<North')
    expect(html).toContain('&lt;North &amp; &quot;South&quot;&gt;')
    expect(html).toContain('next=one&amp;source=&quot;email&quot;')
  })
})
