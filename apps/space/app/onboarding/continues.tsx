/**
 * Where the onboarding stops today.
 *
 * **This screen is a development stand-in, not product.** The onboarding has about
 * twenty steps ahead of it and ends at activation; none of those exist yet. What
 * this replaces is worse than a placeholder: finishing the last built step used to
 * send the person to `/welcome`, which is the "create an account / sign in" front
 * door. Somebody who had just answered every question was shown a screen inviting
 * them to sign up, and signing in again put them right back on it, because the
 * resume decision correctly said "nothing owed" and `/welcome` was standing in for
 * "done". A placeholder that loops to the sign-up screen is not a placeholder.
 *
 * The copy is deliberately about what happens next rather than about progress, and
 * it claims nothing that is not true: the Fitness ID exists and is not active yet.
 * It has not been through copy review, and it should not survive the next
 * onboarding screen landing.
 *
 * No back arrow and no progress bar. Every step behind this one is reachable and
 * editable from the steps themselves; adding a segment here would imply this is a
 * step, and it is not one.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { StyleSheet, View } from 'react-native'

export default function OnboardingContinues() {
  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />

      <View style={styles.body}>
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Hasta aquí\nvamos bien'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Guardamos lo que respondiste. Tu Fitness ID todavía no está activo: faltan algunos pasos
          que estamos construyendo.
        </Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
  lede: { marginTop: 12 },
})
