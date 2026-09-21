/**
 * Una salida que se ofrece: el azulejo de acento, lo que es, y a dónde lleva.
 *
 * **Es la forma que `FIN-9` le da a «Crear una rutina»**, y vale para lo mismo en
 * cualquier otro sitio: una cosa que se puede hacer ahora, con sitio para decir qué
 * pasa si se hace. Un botón corriente cabría, pero un botón es un verbo suelto y esto
 * lleva dos renglones — y el fondo profundo lo separa de la sección de al lado sin
 * gastar el acento, que `Ink & Signal` reserva para una señal por pantalla.
 */

import { SignalBlock } from '@allfitone/react-native/gradient'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

export function OfferRow({
  icon,
  label,
  caption,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  /** Qué pasa al tocarla. Sin esto es un botón, y para eso está el botón. */
  readonly caption: string
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={caption}
      onPress={onPress}
      style={({ pressed }) => [styles.offer, { opacity: pressed ? 0.7 : 1 }]}
    >
      <SignalBlock variant="surfaceDeep" style={styles.block}>
        <View style={[styles.tile, { backgroundColor: theme.color.icon.accent }]}>
          <FoundationIcon name={icon} size="sm" color={theme.color.accent.onAccent} decorative />
        </View>
        <View style={styles.text}>
          <Text role="control" size="md">
            {label}
          </Text>
          <Text role="body" size="xs" color="muted">
            {caption}
          </Text>
        </View>
        <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
      </SignalBlock>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  offer: { borderRadius: 22 },
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 74,
  },
  tile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
})
