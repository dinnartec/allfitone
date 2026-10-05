import { describe, expect, test } from 'bun:test'

import { renderClientInvitationEmail } from './index.js'

const INPUT = {
  organizationName: 'Entrena Norte',
  invitationUrl: 'https://app.allfit.one/client-invitations#token=client-token',
  brandAssetUrl: 'https://app.allfit.one/email/allfit-one-lockup-on-light.png',
  expiresAt: new Date('2026-10-11T12:00:00.000Z'),
}

describe('client invitation email', () => {
  test('says the gym is asking for permission, and that opening it decides nothing', () => {
    const rendered = renderClientInvitationEmail(INPUT)

    expect(rendered.subject).toBe('Entrena Norte te invitó como cliente en Allfit One')
    expect(rendered.text).toContain('te pide permiso para ver información sobre ti')
    expect(rendered.html).toContain('te pide permiso para ver información sobre ti')
    expect(rendered.text).toContain('decides cada uno por separado')
    expect(rendered.text).toContain('Abrir este correo tampoco decide nada')
    expect(rendered.html).toContain(INPUT.invitationUrl)
    expect(rendered.text).toContain('11 de octubre de 2026')
  })

  test('names no category and gives no count: the inbox is not the person', () => {
    const { html, text } = renderClientInvitationEmail(INPUT)

    for (const leak of [
      'body_progress',
      'health_context',
      'nutrition',
      'Progreso corporal',
      'Contexto de salud',
      'permisos',
    ]) {
      expect(text).not.toContain(leak)
      expect(html).not.toContain(leak)
    }
  })

  test('says accepting the relationship is not accepting the data it asked for', () => {
    const { html, text } = renderClientInvitationEmail(INPUT)

    expect(text).toContain('Aceptar entrenar con el gimnasio no le da acceso a tus datos')
    expect(html).toContain('Aceptar entrenar con el gimnasio no le da acceso a tus datos')
  })

  test('escapes the organization name and the link in every HTML context', () => {
    const { html } = renderClientInvitationEmail({
      ...INPUT,
      organizationName: '<North & "South">',
      invitationUrl: 'https://app.allfit.one/client-invitations?next=one&source="email"',
    })

    expect(html).not.toContain('<North')
    expect(html).toContain('&lt;North &amp; &quot;South&quot;&gt;')
    expect(html).toContain('next=one&amp;source=&quot;email&quot;')
  })
})
