/**
 * Account creation.
 *
 * The promise sits above the form because HU-SP-001 is where the product makes
 * its case: registration needs no invitation, no gym and no trainer, and saying
 * so at the moment someone is deciding whether to type an address is worth more
 * than saying it later.
 *
 * The screen never learns whether the address already had an account, and that
 * is deliberate all the way down — the API answers identically either way. It
 * therefore has nothing to display differently, which is the easiest kind of
 * privacy rule to keep: one nobody can break from here.
 *
 * Nothing is wired to the API yet. `AFO-34` covers the contract, the provider
 * port and the endpoints; this screen is composed against them but the client
 * that calls them does not exist, so the button reports that rather than
 * pretending to submit.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

/** Matches the API, which rejects anything shorter before reaching the provider. */
const MIN_PASSWORD_LENGTH = 12

export default function CreateAccount() {
  const theme = useTheme()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const canSubmit = email.includes('@') && password.length >= MIN_PASSWORD_LENGTH

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={() => router.back()}
        hitSlop={8}
        style={styles.back}
      >
        <FoundationIcon
          name="back"
          color={theme.color.icon.primary}
          size="lg"
          strokeScale="compact"
          decorative
        />
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Crea tu\ncuenta'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Empiezas sin gimnasio, sin entrenador y sin invitación.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Correo"
            value={email}
            onChangeText={setEmail}
            placeholder="tu@correo.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="go"
            {...(passwordTooShort
              ? { error: `Necesita al menos ${MIN_PASSWORD_LENGTH} caracteres` }
              : {})}
          />

          <Button label="Crear cuenta" disabled={!canSubmit} style={styles.submit} />

          <Text role="body" size="xs" color="muted" align="center" style={styles.legal}>
            Al continuar aceptas los términos y la política de tratamiento de datos.
          </Text>
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole="link"
        onPress={() => router.replace('/sign-in')}
        style={styles.link}
      >
        <Text role="body" size="sm" color="secondary" align="center">
          ¿Ya tienes cuenta?{' '}
          <Text role="control" size="sm" color="accent">
            Iniciar sesión
          </Text>
        </Text>
      </Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -12,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 8,
  },
  lede: {
    marginTop: 12,
  },
  form: {
    gap: 14,
    marginTop: 28,
  },
  submit: {
    marginTop: 6,
  },
  legal: {
    marginTop: 4,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
})
