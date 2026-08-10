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
 * Nothing authenticates. `/space/v1/auth/*` does not exist in the OpenAPI
 * contract — it is one of the repository's open items. Submitting therefore
 * shows the failure state so the compliant message can be reviewed on device;
 * it is a review stub, not a sign-in attempt, and it goes the moment the
 * endpoint exists.
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

const FAILURE = 'Correo o contraseña incorrectos'

export default function SignIn() {
  const theme = useTheme()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failed, setFailed] = useState(false)

  const canSubmit = email.length > 0 && password.length > 0

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

          {failed ? <InlineAlert message={FAILURE} /> : null}

          <Button
            label="Entrar"
            disabled={!canSubmit}
            onPress={() => setFailed(true)}
            style={styles.submit}
          />

          <Pressable accessibilityRole="link" style={styles.link}>
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
