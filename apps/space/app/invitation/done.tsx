/**
 * `INV-5` · Ya entrenas con tu gimnasio — HU-SP-016.
 *
 * What accepting did, and only that: Pro comes with the gym, and she shares exactly the
 * categories she said yes to. The coach is assigned afterwards in Studio (HU-STUDIO-023),
 * so this screen does not promise one.
 */

import { Button } from '@allfitone/react-native/button'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlyphRow, GymMark, RowCard } from '../../src/components/gym-ui'

export default function InvitationDone() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const {
    gym = '',
    shared = '0',
    asked = '0',
  } = useLocalSearchParams<{
    gym?: string
    shared?: string
    asked?: string
  }>()

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.content}>
        <GymMark name={gym} size={64} />
        <Text role="control" size="2xl" align="center" accessibilityRole="header">
          Ya entrenas con {gym}
        </Text>
        <Text role="body" size="sm" color="secondary" align="center">
          Tu gimnasio te asignará un coach.
        </Text>
        <View style={styles.rows}>
          <RowCard>
            <GlyphRow
              icon="favourite"
              title="Allfit Pro activo"
              caption={`Incluido por ${gym}`}
              accent
            />
            <GlyphRow
              icon="permissions"
              title={`Compartes ${shared} de ${asked} categorías`}
              caption="Las cambias cuando quieras en Perfil"
            />
          </RowCard>
        </View>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Button label="Ir a Hoy" onPress={() => router.replace('/today')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 72, gap: 12 },
  rows: { alignSelf: 'stretch', marginTop: 12 },
  footer: { paddingHorizontal: 24, paddingTop: 14 },
})
