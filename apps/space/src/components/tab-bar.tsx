/**
 * The four destinations, in one bar.
 *
 * It used to be two floating objects: a glass pill with four places and the camera
 * on its own beside it, on the reading that registering a meal is an action rather
 * than a destination. **Comida is a destination now** — it is where the food you
 * logged lives, not a shutter — so it joins the pill and the camera goes. A control
 * that looks like a shutter promises a photo, and that promise was the wrong one.
 *
 * The glass is `GlassPanel` from the Design System, which reserves this material for
 * floating chrome and costs a real backdrop blur: one panel per screen is the budget,
 * and a screen that shows this bar spends it here.
 *
 * **The bar no longer decides where anything goes.** It takes its destinations as
 * children so the tab layout can wrap each one in a `TabTrigger`, which is the only
 * shape Expo Router can see: `parseTriggersFromChildren` descends through fragments
 * and one `asChild` level, and nothing else — a trigger created inside this file, or
 * nested under the glass panel, would never be found and the tab would not exist.
 *
 * **The glass is veiled darker than the material alone.** Over Hoy's photographs and
 * cards the labels competed with what scrolled under them; a canvas-tinted veil inside
 * the panel keeps the glass but lets the words read first.
 *
 * **Every destination leads somewhere.** Comida was the last to answer with what it
 * was waiting on; it has its screen now (ADR-040).
 */

import { GlassPanel } from '@allfitone/react-native/glass'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { withAlpha } from '@allfitone/react-native/tokens'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** The canvas's floating bar, and the room the content has to leave under it. */
export const DOCK_HEIGHT = 70
// Más pegada a los bordes que cuando la cámara le robaba setenta puntos: con cuatro
// destinos cada columna necesita todo el ancho que la pantalla pueda dar.
const DOCK_INSET = 8
/** How much canvas the veil lays over the glass: enough for the labels to read first. */
const VEIL = 0.6

export type TabKey = 'today' | 'train' | 'food' | 'profile'

export interface TabBarProps {
  /** The destinations, already wrapped in whatever the router needs. */
  readonly children: ReactNode
}

export function TabBar({ children }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const theme = useTheme()

  return (
    <View style={[styles.dock, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <GlassPanel radius="action" style={styles.glass}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: withAlpha(theme.color.background.canvas, VEIL) },
          ]}
        />
        {children}
      </GlassPanel>
    </View>
  )
}

/**
 * One destination. Exported because the tab layout composes these itself now, and
 * because a `TabTrigger` hands its child the press handling but not the selection —
 * whether this one is the current tab comes from the path, above.
 */
export function Tab({
  icon,
  label,
  active,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  readonly active: boolean
  readonly onPress?: (() => void) | undefined
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      disabled={active}
      style={styles.tab}
    >
      <FoundationIcon
        name={icon}
        size="lg"
        color={active ? theme.color.icon.accent : theme.color.icon.secondary}
        decorative
      />
      {/* Las cuatro al mismo cuerpo, sin que ninguna se encoja por su cuenta: dos
          etiquetas de tamaños distintos en la misma barra se leen como un fallo, no
          como jerarquía. Cabe porque cada columna mide su palabra, no un quinto. */}
      <Text role="control" size="2xs" color={active ? 'accent' : 'muted'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: DOCK_INSET,
    right: DOCK_INSET,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  glass: {
    flex: 1,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  // **Columnas iguales.** Se probó dejando que cada una midiera su palabra, para que
  // «Entrenamiento» cupiera entero: caber cabía, pero los iconos perdían el ritmo
  // —ciento noventa y tres puntos entre dos y ciento cincuenta y tres entre otros
  // dos— y una barra cuyos iconos no están a la misma distancia se lee rota. El
  // ritmo del icono manda sobre el largo de la palabra.
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 44, justifyContent: 'center' },
})
