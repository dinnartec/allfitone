/**
 * Email verification.
 *
 * The wording still satisfies HU-SP-001 criterion 3, which requires the same
 * message whether or not the address already had an account. It is the *same
 * message either way* that carries the rule, not the hedging: the story itself
 * describes the compliant copy as telling the person to check their mail
 * "exista o no". An earlier version said "si ese correo puede recibir una
 * cuenta", which met the rule and read like a legal notice.
 *
 * The panel below the code exists for criterion 4: creating an account does not
 * grant a Fitness ID. Someone who abandons here has left a credential and
 * nothing else, and saying so beats letting them assume otherwise.
 *
 * The code is entered through `CodeField`, which owns the segmented boxes, the
 * digit filtering and the refusal to set `returnKeyType` — the iOS number pad
 * has no return key, and asking for one floats a loose button over the layout.
 * All of that lives in the design system so the next screen that takes a code
 * inherits it instead of rediscovering it.
 *
 * Verification confirms the address and then signs in, which is why the password
 * comes along. See the note in `create-account.tsx` about what that costs and
 * why the alternative did not survive contact with the provider.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { CodeField } from '@allfitone/react-native/code-field'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError, register, verifyRegistration } from '../src/client'
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
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const canSubmit = code.length === CODE_LENGTH && !submitting

  const resend = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      // Registering again is what re-sends: the provider treats a repeat as the
      // already-registered path and issues a fresh code, so there is no separate
      // resend endpoint to call.
      await register(email, password)
      setCode('')
      setNotice('Te enviamos un código nuevo.')
    } catch {
      setFailure('No pudimos reenviar el código. Inténtalo otra vez.')
    } finally {
      setSubmitting(false)
    }
  }

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
          Te enviamos un código de seis dígitos{email ? ` a ${email}` : ' a tu correo'}.
        </Text>

        <View style={styles.form}>
          <CodeField
            label="Código"
            value={code}
            onChangeText={(next) => {
              setNotice(undefined)
              setCode(next)
            }}
            length={CODE_LENGTH}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
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
          {notice && !failure ? <InlineAlert message={notice} tone="success" /> : null}

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

      <Pressable
        accessibilityRole="link"
        disabled={submitting}
        onPress={() => {
          void resend()
        }}
        style={styles.link}
      >
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
