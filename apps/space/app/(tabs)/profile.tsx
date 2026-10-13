/**
 * `Perfil` — for now, the one thing it has to hold: `HU-SP-003`.
 *
 * The tab promised a screen and answered with a notice, which meant the app had no way
 * to sign out at all. On a phone that is not a missing feature, it is somebody stuck
 * inside: the only remedy was deleting the app.
 *
 * This is deliberately not the whole profile. Data, permissions, contact and access
 * records are their own stories; putting a placeholder for each here would be four
 * more promises the screen cannot keep. What it does say honestly is which of them are
 * still coming.
 *
 * **The confirmation is not ceremony.** `HU-SP-003` criterion 2 requires a warning
 * when a workout has not reached the server, because erasing the tokens takes it with
 * it. So the first press asks and the second forgets — and the flow, not this screen,
 * decides which is which.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { createSpaceSignOutFlow } from '../../src/client/sign-out-transport'
import { forgetExerciseLibrary } from '../../src/client/exercise-library'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const LOCAL_ONLY =
  'Cerramos sesión en este teléfono. No pudimos avisarle al servidor, así que hazlo otra vez cuando tengas conexión.'

const COMING = [
  'Tus datos y tus medidas',
  'Quién puede ver tu historial',
  'Tu correo y tus notificaciones',
]

export default function Profile() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceSignOutFlow(), [])

  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const leave = async (force: boolean) => {
    setBusy(true)
    setWarning(false)
    try {
      const outcome = await flow.signOut(force ? { force: true } : undefined)
      if (outcome.state === 'unsynced-workout') {
        setWarning(true)
        return
      }
      // Nothing personal is in it, but a cache that outlives the session it was read
      // under is a cache nobody can reason about.
      forgetExerciseLibrary()
      // Replaced, not pushed: there must be no way back into a signed-out session.
      router.replace('/welcome')
      if (outcome.state === 'signed-out-locally') setNotice(LOCAL_ONLY)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text role="display" size="2xl" uppercase accessibilityRole="header">
            Perfil
          </Text>
          <Text role="body" size="sm" color="muted">
            Tu cuenta en este teléfono.
          </Text>
        </View>

        {notice ? <InlineAlert message={notice} /> : null}

        {/* The one thing on this screen that is not an account action. It lives here
            because paying a gym is between her and the gym, and nothing else in the app
            is about that. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver mis planes"
          onPress={() => router.push('/subscriptions')}
          style={[styles.row, { borderColor: theme.color.border.subtle }]}
        >
          <FoundationIcon name="business" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="sm" style={styles.grow}>
            Mis planes
          </Text>
          <FoundationIcon name="forward" color={theme.color.icon.secondary} decorative />
        </Pressable>

        <View style={styles.section}>
          <Text role="eyebrow" size="2xs" color="muted">
            EN CAMINO
          </Text>
          {COMING.map((item) => (
            <View key={item} style={styles.coming}>
              <FoundationIcon
                name="locked"
                size="sm"
                color={theme.color.icon.secondary}
                decorative
              />
              <Text role="body" size="sm" color="muted">
                {item}
              </Text>
            </View>
          ))}
        </View>

        <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />

        <Button
          label="Cerrar sesión"
          variant="secondary"
          loading={busy}
          onPress={() => void leave(false)}
        />
        <Text role="body" size="sm" color="muted" style={styles.centered}>
          No queda nada tuyo guardado en este teléfono.
        </Text>
      </ScrollView>

      <Sheet
        visible={warning}
        onDismiss={() => setWarning(false)}
        title="Tienes un entrenamiento sin terminar"
      >
        <View style={styles.sheetBody}>
          <Text role="body" size="sm" color="secondary">
            Dejaste una sesión abierta y todavía no llegó al servidor. Si cierras sesión ahora, se
            pierde lo que registraste en ella.
          </Text>
          <Button
            label="Volver al entrenamiento"
            onPress={() => {
              setWarning(false)
              router.replace('/today')
            }}
          />
          <Button
            label="Cerrar sesión de todas formas"
            variant="ghost"
            onPress={() => void leave(true)}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: DOCK_HEIGHT + 40 },
  heading: { gap: 4 },
  section: { gap: 10 },
  coming: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  divider: { height: 1 },
  centered: { textAlign: 'center' },
  sheetBody: { gap: 12 },
  pending: {
    position: 'absolute',
    bottom: DOCK_HEIGHT + 8,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
})
