/**
 * Adult declaration — HU-SP-007.
 *
 * This is the first gate of the onboarding and it exists before anything else
 * because criterion 1 forbids asking for a single body, training or health value
 * until adult eligibility is settled. Nothing on this screen stores such a value,
 * which is what makes the ordering enforceable rather than merely intended.
 *
 * No date of birth. Criterion 4 says a declaration of adulthood resolves the
 * control, and an earlier design that asked for a full birth date was dropped for
 * exactly that reason: collecting a precise date we do not need would be worse
 * privacy for the same outcome.
 *
 * There is no explicit "I am under 18" path. Not affirming is not advancing,
 * which satisfies criteria 2 and 3 without recording a failed evaluation against
 * somebody who merely hesitated — and criterion 3 is the strict one: a doubt
 * must never pass as eligible.
 *
 * No back arrow either, unlike the account screens. The only thing behind this
 * gate is abandoning the onboarding, and the platform gesture already offers
 * that; drawing an arrow that leads nowhere useful would suggest a step to
 * return to.
 *
 * The policy version the person was held to is frozen server-side into the
 * evidence, which is criterion 5. It is deliberately not shown here: it is a
 * record we must keep, not a decision the person makes.
 *
 * The screen holds no logic beyond presentation. Opening the attempt, keeping the
 * idempotency key across a retry and recording the declaration live in
 * `src/client/onboarding`, where they can be tested without launching the app.
 */

import { Button } from '@allfitone/react-native/button'
import { Checkbox } from '@allfitone/react-native/checkbox'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { FIRST_STEP_ROUTE } from '../../src/client/onboarding-steps'

const DECLARATION = 'Declaro que tengo 18 años o más.'

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

export default function AdultDeclaration() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [declared, setDeclared] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      const evidence = await flow.declareAdult(declared)
      // A refusal is recorded but never eligibility, so the flow stops here
      // rather than advancing on evidence that did not pass.
      if (evidence.result !== 'pass') {
        setFailure('No podemos continuar sin la declaración de mayoría de edad.')
        return
      }
      router.replace(FIRST_STEP_ROUTE)
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unauthenticated'
          ? 'Tu sesión venció. Inicia sesión otra vez.'
          : 'No pudimos guardar tu declaración. Inténtalo otra vez.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']} dots>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Antes de\nempezar'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Allfit Space es solo para personas mayores de edad. No te pedimos tu fecha de nacimiento.
        </Text>

        <View style={styles.form}>
          <Checkbox
            label={DECLARATION}
            checked={declared}
            onChange={setDeclared}
            disabled={submitting}
          />
        </View>
      </ScrollView>

      {/* Outside the scroll so the button sits in the same place on every step of
          the onboarding, whatever the content above it does. */}
      <View style={styles.footer}>
        {failure ? <InlineAlert message={failure} /> : null}

        <Button
          label="Continuar"
          disabled={!declared || submitting}
          loading={submitting}
          onPress={() => {
            void submit()
          }}
          style={styles.submit}
        />
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
  submit: {
    marginTop: 4,
  },
})
