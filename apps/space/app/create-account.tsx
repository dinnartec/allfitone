/**
 * Account creation.
 *
 * The promise sits above the form because HU-SP-001 is where the product makes
 * its case: registration needs no invitation, no gym and no trainer, and saying
 * so at the moment someone is deciding whether to type an address is worth more
 * than saying it later.
 *
 * Submitting always moves to verification. The API answers identically whether
 * or not the address was taken, so there is no "already registered" branch to
 * write — not because the screen is lax, but because the response admits no
 * other behaviour. That is HU-SP-001 criterion 3 arriving here as an absence.
 *
 * KNOWN GAP — the password travels to the next screen as a route parameter,
 * because verification signs in once the address is confirmed. Expo Router keeps
 * params in navigation state, so the value can surface in a state dump. It never
 * leaves the device and never lands in storage. An opaque handle was tried and
 * removed: the provider invalidates it the moment the code is emailed, so the
 * two cannot coexist. Closing this needs the API to hold the credential for the
 * few minutes verification takes, which is a contract change.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError, register } from '../src/client'

/** Mirrors the API, which rejects anything else before reaching the provider. */
const MIN_PASSWORD_LENGTH = 8
const PASSWORD_COMPOSITION = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/

const PASSWORD_RULE = 'Al menos 8 caracteres, con una mayúscula, una minúscula y un número'

/**
 * Only the password case is described precisely. The others are deliberately
 * vague: the API cannot tell us whether the address was taken, and inventing a
 * more specific message would either be a guess or a disclosure.
 */
function messageFor(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Algo salió mal. Inténtalo otra vez.'
  switch (cause.failure) {
    case 'weak-password':
      // Reached only when the password passed our rules and the provider still
      // refused it, which now means it resembles something already breached
      // rather than that it is short.
      return 'Esa contraseña es demasiado fácil de adivinar. Cámbiale algunas letras o alárgala.'
    case 'unavailable':
      return 'No pudimos conectar. Revisa tu conexión e inténtalo otra vez.'
    default:
      return 'Revisa el correo y la contraseña.'
  }
}

export default function CreateAccount() {
  const theme = useTheme()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const passwordValid =
    password.length >= MIN_PASSWORD_LENGTH && PASSWORD_COMPOSITION.test(password)
  const passwordProblem = password.length > 0 && !passwordValid
  const canSubmit = email.includes('@') && passwordValid && !submitting

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    const address = email.trim()
    try {
      await register(address, password)
      router.push({ pathname: '/verify-email', params: { email: address, password } })
    } catch (cause) {
      setFailure(messageFor(cause))
    } finally {
      setSubmitting(false)
    }
  }

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
            editable={!submitting}
          />

          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 8 caracteres"
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="go"
            editable={!submitting}
            {...(passwordProblem ? { error: PASSWORD_RULE } : {})}
          />

          {failure ? <InlineAlert message={failure} /> : null}

          <Button
            label="Crear cuenta"
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => {
              void submit()
            }}
            style={styles.submit}
          />

          <Text role="body" size="sm" color="muted" align="center" style={styles.legal}>
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
