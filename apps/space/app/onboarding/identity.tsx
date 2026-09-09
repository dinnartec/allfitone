/**
 * Onboarding identity — HU-SP-098.
 *
 * The screen that had to exist before the rest of the onboarding could. Creating
 * a Fitness ID requires a given name and a family name — `identity.people` has
 * both as `not null` and `identity.activate_person` refuses without them — and no
 * Space story asked for either. In Studio they arrive from the identity provider;
 * Space signs in headless, so the provider only ever knew an email and a
 * password.
 *
 * Submitting creates the Fitness ID in `pending_activation`. That is the whole
 * point of doing it here rather than at the end: profile claims require a
 * `person_id`, so with the person created last every answer that follows would
 * need a staging table and a second write path. From this screen onwards each
 * answer is written where it belongs the first time.
 *
 * Which is also why the screen skips itself when the Fitness ID already exists —
 * there is nothing left to create, and re-asking would offer to create a second.
 * Where it goes instead is `resolveOnboardingRoute`'s call, not this screen's.
 *
 * The email is shown and cannot be edited. It belongs to the credential, and
 * changing it is a different operation with its own verification. It is read from
 * what the app stored when the person signed in rather than returned by the API:
 * the provider's verified address is server-only, and Studio already establishes
 * that contact does not travel in a token response.
 *
 * Two departures from `prototipos/07-identidad.html`, both deliberate. The email
 * is a labelled fact rather than a disabled field, because a field that cannot be
 * typed into misrepresents what it is — and because `TextField` has no disabled
 * state, so the alternative was a design-system change for a worse result. And
 * there is no padlock glyph: the icon catalogue has none, and saying it in words
 * beats adding an icon to carry a meaning that words carry better.
 *
 * The username is the one field that can fail on the server for a reason worth
 * retyping. There is no availability check by design — asking whether a handle is
 * free would reveal that somebody holds it — so a collision comes back as a
 * conflict on submit and lands on the field itself.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { OnboardingHeader } from '../../src/components/onboarding-header'
import { ApiError } from '../../src/client'
import { canSubmitIdentity, isUsernameWellFormed } from '../../src/client/identity-form'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { readSession } from '../../src/client/session'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'

const NAME_MAX_LENGTH = 120
const USERNAME_MAX_LENGTH = 30

const USERNAME_RULE =
  'De 3 a 30 caracteres, empezando con una letra. Solo letras, números y guion bajo.'
const TAKEN = 'Ese usuario ya está en uso. Prueba con otro.'
/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tus datos.'
const UNREACHABLE = 'No pudimos guardar tus datos. Inténtalo otra vez.'

export default function OnboardingIdentity() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [email, setEmail] = useState<string | undefined>(undefined)
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [username, setUsername] = useState('')
  const [takenUsername, setTakenUsername] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    // The address is local, so it survives an outage; the answers are not.
    void readSession().then((session) => {
      if (active && session?.email) setEmail(session.email)
    })

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards. Being ahead of the first owed step is not a reason to
        // move: a person who came back to change their name belongs here.
        const owed = guardStep('/onboarding/identity', current)
        if (owed) {
          router.replace(owed)
          return
        }
        const declared = current.answers.identity.value
        if (declared) {
          setGivenName(declared.given_name)
          setFamilyName(declared.family_name)
          setUsername(declared.username)
        }
      })
      .catch((cause: unknown) => {
        // An outage must not empty a form the person can still fill in, and a
        // dead session must not read as one: the answers differ.
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(UNREACHABLE)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const usernameError = username && username === takenUsername ? TAKEN : undefined
  const editable = !submitting && !sessionExpired
  const complete = canSubmitIdentity({
    givenName,
    familyName,
    username,
    submitting,
    sessionExpired,
  })

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.createFitnessId({
        given_name: givenName.trim(),
        family_name: familyName.trim(),
        username,
      })
      router.replace(nextRouteAfter('/onboarding/identity'))
    } catch (cause) {
      if (cause instanceof ApiError && cause.failure === 'conflict') {
        // Held against the value, so the message clears the moment it changes.
        setTakenUsername(username)
        return
      }
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
        return
      }
      setFailure(UNREACHABLE)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />

      <OnboardingHeader step="/onboarding/identity" />

      {/* The keyboard moves the scroll inset, not the container. Without this the
          username field sat under the keyboard and no amount of dragging revealed it:
          the content already fits, so there was nothing to scroll. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Cómo te\nllamas'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Tu nombre viaja con lo que decidas compartir. El usuario es tu identificador en Allfit.
        </Text>

        <View style={styles.form}>
          <View style={styles.pair}>
            <TextField
              label="Nombre"
              value={givenName}
              onChangeText={setGivenName}
              maxLength={NAME_MAX_LENGTH}
              autoCapitalize="words"
              autoComplete="given-name"
              editable={editable}
              style={styles.half}
            />
            <TextField
              label="Apellido"
              value={familyName}
              onChangeText={setFamilyName}
              maxLength={NAME_MAX_LENGTH}
              autoCapitalize="words"
              autoComplete="family-name"
              editable={editable}
              style={styles.half}
            />
          </View>

          <View>
            <Text role="label" size="xs" color="secondary" uppercase>
              Entras con
            </Text>
            <Text role="body" size="md" style={styles.email}>
              {email ?? '—'}
            </Text>
            <Text role="body" size="sm" color="muted" style={styles.hint}>
              No se puede cambiar aquí.
            </Text>
          </View>

          <View>
            <TextField
              label="Usuario"
              value={username}
              // Lowercased as typed: two handles differing only in case are the
              // same handle, so showing otherwise would promise a choice.
              onChangeText={(value) => setUsername(value.toLowerCase())}
              maxLength={USERNAME_MAX_LENGTH}
              autoCapitalize="none"
              autoCorrect={false}
              editable={editable}
              {...(usernameError ? { error: usernameError } : {})}
            />
            <Text role="body" size="sm" color="muted" style={styles.hint}>
              {isUsernameWellFormed(username) ? `Así te verán: @${username}` : USERNAME_RULE}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Outside the scroll so the button sits in the same place on every step of
          the onboarding, whatever the content above it does. */}
      <View style={styles.footer}>
        {failure ? <InlineAlert message={failure} /> : null}

        <Button
          label="Continuar"
          disabled={!complete}
          loading={submitting}
          onPress={() => {
            void submit()
          }}
          style={styles.submit}
        />

        {/* Without this the screen says "sign in again" and offers no way to. */}
        {sessionExpired ? (
          <Button
            label="Iniciar sesión"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
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
    gap: 18,
    marginTop: 32,
  },
  pair: {
    flexDirection: 'row',
    gap: 10,
  },
  half: {
    flex: 1,
  },
  email: {
    marginTop: 8,
  },
  hint: {
    marginTop: 7,
  },
  submit: {
    marginTop: 4,
  },
})
