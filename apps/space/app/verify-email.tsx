/**
 * Email verification.
 *
 * The wording is the criterion. HU-SP-001 criterion 3 requires the same message
 * whether or not the address already had an account, so the copy says *"si ese
 * correo puede recibir una cuenta"* rather than "te enviamos un código" — the
 * second sentence asserts something the reader can check, and checking it is
 * exactly how an address gets confirmed as registered.
 *
 * The panel below the code exists for criterion 4: creating an account does not
 * grant a Fitness ID. Someone who abandons here has left a credential and
 * nothing else, and saying so beats letting them assume otherwise.
 *
 * KNOWN GAP — the password arrives as a route parameter, because the provider
 * mints its pending verification token from a sign-in attempt and the code alone
 * cannot redeem a session. Expo Router puts params in the navigation state, so
 * the value can surface in a state dump or a deep link. It never leaves the
 * device and never lands in storage, but it is more exposure than a password
 * deserves. The fix is for the API to hold the pending token behind a short
 * opaque handle; that is a contract change, not a screen change, and it is
 * tracked rather than quietly accepted.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError, verifyRegistration } from '../src/client'
import { storeSession } from '../src/client/session'

const CODE_LENGTH = 6

export default function VerifyEmail() {
  const theme = useTheme()
  const router = useRouter()
  const { email = '', password = '' } = useLocalSearchParams<{
    email?: string
    password?: string
  }>()

  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const canSubmit = code.length === CODE_LENGTH && !submitting

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      const session = await verifyRegistration(email, password, code)
      await storeSession(session)
      // Onboarding has no screen yet. Landing on the welcome screen with a
      // session is wrong, but inventing a destination would be worse — the next
      // slice replaces this line.
      router.replace('/welcome')
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unavailable'
          ? 'No pudimos conectar. Revisa tu conexión e inténtalo otra vez.'
          : 'El código no es válido o ya venció.',
      )
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
          {'Revisa tu\ncorreo'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Si ese correo puede recibir una cuenta, le enviamos un código de seis dígitos
          {email ? ` a ${email}` : ''}.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Código"
            value={code}
            onChangeText={(next) => setCode(next.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))}
            placeholder="000000"
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            returnKeyType="go"
            editable={!submitting}
          />

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
              Todavía no tienes Fitness ID
            </Text>
            <Text role="body" size="sm" color="secondary" style={styles.noteBody}>
              Se activa cuando completes el registro. Crear la cuenta es solo el primer paso.
            </Text>
          </View>

          {failure ? <InlineAlert message={failure} /> : null}

          <Button
            label="Verificar"
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => {
              void submit()
            }}
            style={styles.submit}
          />
        </View>
      </ScrollView>

      <Pressable accessibilityRole="link" style={styles.link}>
        <Text role="body" size="sm" color="secondary" align="center">
          ¿No te llegó?{' '}
          <Text role="control" size="sm" color="accent">
            Reenviar
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
  note: {
    borderWidth: 1,
    gap: 6,
  },
  noteBody: {
    marginTop: 2,
  },
  submit: {
    marginTop: 6,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
})
