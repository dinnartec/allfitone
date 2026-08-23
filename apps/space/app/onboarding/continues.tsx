/**
 * Where the onboarding stops today.
 *
 * **This screen is a development stand-in, not product.** The onboarding has about
 * twenty steps ahead of it and ends at activation; none of those exist yet. What it
 * replaces is worse than a placeholder: finishing the last built step used to send
 * the person to `/welcome`, which is the "create an account / sign in" front door.
 * Somebody who had just answered every question was shown a screen inviting them to
 * sign up, and signing in again put them right back on it, because the resume
 * decision correctly said "nothing owed" and `/welcome` was standing in for "done".
 *
 * The copy claims nothing untrue — the Fitness ID exists and is not active yet — but
 * it has not been through copy review and should not survive the next onboarding
 * screen landing.
 *
 * The arrow goes back to the last step a person may change, derived from the declared
 * order rather than named here, so appending a step moves it. No progress bar: this
 * is not a step, and a segment would say it was.
 *
 * **Signing out only clears this device.** Space has no sign-out operation —
 * `OP-IDN-040`, `041` and `042` are all it declares, and Studio's hosted logout has
 * no Space equivalent — so the stored tokens are deleted here and the session is left
 * standing on the server until it expires. That is a real gap and it is the reason
 * this button says what it says rather than promising more. Revoking properly needs
 * its own operation, route and tests.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { lastRevisitableStep } from '../../src/client/onboarding-steps'
import { clearSession } from '../../src/client/session'
import { OnboardingBack } from '../../src/components/onboarding-header'

export default function OnboardingContinues() {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  const back = lastRevisitableStep()

  const signOut = async () => {
    setLeaving(true)
    // Deleting the tokens is the whole of it today, and it must not fail loudly:
    // there is nothing useful to tell somebody who asked to leave.
    await clearSession().catch(() => undefined)
    router.replace('/welcome')
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />

      {back ? <OnboardingBack to={back} /> : null}

      <View style={styles.body}>
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Hasta aquí\nvamos bien'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Guardamos lo que respondiste. Tu Fitness ID todavía no está activo: faltan algunos pasos
          que estamos construyendo.
        </Text>
      </View>

      <Button
        label="Cerrar sesión"
        variant="secondary"
        loading={leaving}
        onPress={() => {
          void signOut()
        }}
        style={styles.leave}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
  lede: { marginTop: 12 },
  leave: { marginBottom: 26 },
})
