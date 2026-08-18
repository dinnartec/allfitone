/**
 * Password recovery, as a sheet over sign-in rather than as screens.
 *
 * The person is on sign-in when they realise they have forgotten the password,
 * and sign-in is exactly where they need to be once the new one is set. Routing
 * this would have meant choosing a destination the flow already had, so the sheet
 * keeps the screen behind it and closing is the return.
 *
 * Two states in one sheet. The confirmation is not a second place — nothing
 * changed about where the person is, only about what they are waiting for.
 *
 * The address arrives already filled from sign-in. Somebody who just typed it and
 * got the password wrong should not be asked for it again.
 *
 * There is no third state. The new password is set on the provider's page, which
 * never hands us its URL, so the app's part ends when the mail is sent.
 */

import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { requestPasswordReset } from '../client'
import { createPasswordResetFlow } from '../client/password-reset'

const INVALID = 'Escribe un correo válido.'
const UNREACHABLE = 'No pudimos conectar. Revisa tu conexión e inténtalo otra vez.'

export function PasswordResetSheet({
  visible,
  onDismiss,
  email,
}: {
  readonly visible: boolean
  readonly onDismiss: () => void
  readonly email: string
}) {
  const theme = useTheme()
  const flow = useMemo(() => createPasswordResetFlow({ request: requestPasswordReset }), [])

  const [address, setAddress] = useState(email)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // Reopening starts over: a sheet that reappeared on its confirmation would be
  // reporting a send that belongs to the previous time it was opened.
  useEffect(() => {
    if (visible) {
      setAddress(email)
      setSent(false)
      setFailure(undefined)
    }
  }, [visible, email])

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    const outcome = await flow.submit(address)
    setSubmitting(false)
    if (outcome === 'sent') setSent(true)
    else setFailure(outcome === 'invalid' ? INVALID : UNREACHABLE)
  }

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      title={sent ? 'Te enviamos\nun enlace' : 'Recupera tu\ncontraseña'}
    >
      {sent ? (
        <View style={styles.stack}>
          <Text role="body" size="sm" color="secondary">
            Revisa{' '}
            <Text role="control" size="sm" color="primary">
              {address.trim()}
            </Text>{' '}
            y ábrelo para crear una contraseña nueva. Vence en poco tiempo.
          </Text>

          <View
            style={[
              styles.note,
              {
                backgroundColor: theme.color.accent.tonal,
                borderColor: theme.color.accent.tonalBorder,
                borderRadius: theme.semanticRadius.card,
                padding: theme.semanticSpacing.cardInset,
              },
            ]}
          >
            <Text role="eyebrow" size="xs" color="accent">
              Al cambiarla
            </Text>
            <Text role="body" size="sm" color="secondary" style={styles.noteBody}>
              Se cierran todas tus sesiones. Vuelve a entrar con la contraseña nueva.
            </Text>
          </View>

          <Button label="Entendido" onPress={onDismiss} />
        </View>
      ) : (
        <View style={styles.stack}>
          <Text role="body" size="sm" color="secondary">
            Te enviaremos un enlace a este correo para que crees una nueva.
          </Text>

          <TextField
            label="Correo"
            value={address}
            onChangeText={setAddress}
            placeholder="tu@correo.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            textContentType="emailAddress"
            editable={!submitting}
          />

          {failure ? <InlineAlert message={failure} /> : null}

          <Button
            label="Enviar enlace"
            loading={submitting}
            disabled={submitting}
            onPress={() => {
              void submit()
            }}
          />
        </View>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 14,
  },
  note: {
    borderWidth: 1,
    gap: 6,
  },
  noteBody: {
    marginTop: 2,
  },
})
