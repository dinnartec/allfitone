/**
 * Una salida que se ofrece: el azulejo de acento, lo que es, y a dónde lleva.
 *
 * **Es la forma que `FIN-9` le da a «Crear una rutina»**, y vale para lo mismo en
 * cualquier otro sitio: una cosa que se puede hacer ahora, con sitio para decir qué
 * pasa si se hace. Un botón corriente cabría, pero un botón es un verbo suelto y esto
 * lleva dos renglones.
 *
 * **Dos tonos, porque el lienzo dibuja dos.** `deep` es la de `FIN-9`: fondo profundo,
 * azulejo de acento macizo y chevron, para cuando la fila **es** lo que hay que hacer en
 * esa hoja. `quiet` es la de `FIN-2b`: plana, con el azulejo apenas teñido y sin flecha,
 * para cuando vive entre secciones de una pantalla que ya tiene su protagonista — y
 * llamar la atención tanto como el carrusel sería competir con él.
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
  tone = 'deep',
  captionColor = 'muted',
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  /** Qué pasa al tocarla. Sin esto es un botón, y para eso está el botón. */
  readonly caption: string
  readonly tone?: 'deep' | 'quiet'
  /** Accent when the caption says something is waiting, not what the row does. */
  readonly captionColor?: 'muted' | 'accent'
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const quiet = tone === 'quiet'

  const inside = (
    <>
      <View
        style={[
          quiet ? styles.tileQuiet : styles.tile,
          { backgroundColor: quiet ? theme.color.accent.tonal : theme.color.icon.accent },
        ]}
      >
        <FoundationIcon
          name={icon}
          size="sm"
          color={quiet ? theme.color.icon.accent : theme.color.accent.onAccent}
          decorative
        />
      </View>
      <View style={styles.text}>
        <Text role="control" size="md">
          {label}
        </Text>
        <Text role="body" size="sm" color={captionColor}>
          {caption}
        </Text>
      </View>
      {quiet ? null : (
        <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
      )}
    </>
  )

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={caption}
      onPress={onPress}
      style={({ pressed }) => [
        quiet ? styles.offerQuiet : styles.offer,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {quiet ? (
        <View
          style={[
            styles.blockQuiet,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          {inside}
        </View>
      ) : (
        <SignalBlock variant="surfaceDeep" style={styles.block}>
          {inside}
        </SignalBlock>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  offer: { borderRadius: 22 },
  offerQuiet: { borderRadius: 20 },
  blockQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tileQuiet: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
