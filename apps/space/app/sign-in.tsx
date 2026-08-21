/**
 * Sign-in screen.
 *
 * The failure message is the whole point of this screen. HU-SP-002 criterion 2
 * requires that a failed attempt never say whether the address or the password
 * was wrong: a message that distinguishes them turns the form into an oracle for
 * which addresses are registered. So one message covers both, and both fields
 * are marked — marking only the password would leak the same fact visually.
 *
 * The keyboard adjusts the scroll inset instead of resizing the container. A
 * `KeyboardAvoidingView` shrinks the available height, so anything centred or
 * spaced with `flex` recomputes and the whole screen visibly reflows on every
 * focus change. Changing only the inset leaves the layout untouched and simply
 * scrolls the focused field into view, which keeps the content centred without
 * the jump. Android needs `softwareKeyboardLayoutMode: "pan"` for the same
 * reason: the default resizes the window.
 *
 * Only two outcomes are distinguished, and deliberately so. A refused credential
 * and an unknown address both arrive as `unauthenticated`, because the API
 * answers them identically; the one case worth separating is an unreachable API,
 * where telling somebody their password is wrong would be a lie.
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

import { ApiError, signIn } from '../src/client'
import { storeSession } from '../src/client/session'
import { PasswordResetSheet } from '../src/components/password-reset-sheet'

const FAILURE = 'Correo o contraseña incorrectos'
const UNREACHABLE = 'No pudimos conectar. Revisa tu conexión e inténtalo otra vez.'

export default function SignIn() {
  const theme = useTheme()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [resetting, setResetting] = useState(false)

  const failed = failure === FAILURE
  const canSubmit = email.length > 0 && password.length > 0 && !submitting

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      const session = await signIn(email.trim(), password)
      await storeSession(session)
      router.replace('/onboarding/age')
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unavailable' ? UNREACHABLE : FAILURE,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />
      {/* Outside the scroll view: the content below is centred, and a back
          control that drifts to the middle of the screen with it is unfindable. */}
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
        <Text role="display" size="4xl" uppercase accessibilityRole="header" style={styles.title}>
          {'Vuelve a\nentrenar'}
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
            {...(failed ? { error: '' } : {})}
          />

          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="Tu contraseña"
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            {...(failed ? { error: '' } : {})}
          />

          {failure ? <InlineAlert message={failure} /> : null}

          <Button
            label="Entrar"
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => {
              void submit()
            }}
            style={styles.submit}
          />

          <Pressable
            accessibilityRole="link"
            onPress={() => setResetting(true)}
            style={styles.link}
          >
            <Text role="body" size="sm" color="secondary" align="center">
              ¿Olvidaste tu contraseña?{' '}
              <Text role="control" size="sm" color="accent">
                Restablecer
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Anchored to the bottom rather than trailing the form. Inside the
          centred block its own margin would push the fields up instead of
          moving the link down. */}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.replace('/create-account')}
        style={styles.link}
      >
        <Text role="body" size="sm" color="secondary" align="center">
          ¿No tienes cuenta?{' '}
          <Text role="control" size="sm" color="accent">
            Crear una
          </Text>
        </Text>
      </Pressable>
      <PasswordResetSheet visible={resetting} onDismiss={() => setResetting(false)} email={email} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 8,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -12,
  },
  title: {
    marginTop: 0,
  },
  form: {
    gap: 14,
    marginTop: 24,
  },
  submit: {
    marginTop: 6,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
})
