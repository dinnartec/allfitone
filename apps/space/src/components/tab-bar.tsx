/**
 * The five destinations, as the canvas's split-glass variant.
 *
 * Two floating objects rather than one bar: a glass pill holding the four places you
 * go, and the camera on its own beside it. Registering a meal is not a destination —
 * it is the action you take from wherever you are — and putting it inside the bar as
 * a fifth tab made it look like one.
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
 * **Only Hoy, Entrenar and Perfil lead anywhere today.** The rest answer with the
 * screen they are waiting on rather than navigating into nothing: a dead end that
 * explains itself is not the empty screen `HU-SP-090` criterion 3 forbids, and a
 * blank one would be.
 */

import { GlassPanel } from '@allfitone/react-native/glass'
import { resolveShadowStyle } from '@allfitone/react-native/shadow-style'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** The canvas's floating bar, and the room the content has to leave under it. */
export const DOCK_HEIGHT = 70
const DOCK_INSET = 16

export type TabKey = 'today' | 'train' | 'history' | 'profile'

/** What a destination that does not exist yet answers instead of navigating. */
export const PENDING: Record<'history' | 'food', string> = {
  history: 'Tu historial llega con las sesiones registradas.',
  food: 'Comida llega con el registro de nutrición.',
}

export interface TabBarProps {
  /** The destinations, already wrapped in whatever the router needs. */
  readonly children: ReactNode
  readonly onPending: (message: string) => void
}

export function TabBar({ children, onPending }: TabBarProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.dock, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <GlassPanel radius="action" style={styles.glass}>
        {children}
      </GlassPanel>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Registrar una comida"
        onPress={() => onPending(PENDING.food)}
        style={[
          styles.capture,
          resolveShadowStyle('floating'),
          { backgroundColor: theme.color.action.primary },
        ]}
      >
        <FoundationIcon name="camera" size="md" color={theme.color.action.onPrimary} decorative />
        <Text role="control" size="2xs" style={{ color: theme.color.action.onPrimary }}>
          Comida
        </Text>
      </Pressable>
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
        size="md"
        color={active ? theme.color.icon.accent : theme.color.icon.secondary}
        decorative
      />
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
    paddingHorizontal: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 44, justifyContent: 'center' },
  // Square, so the pill and the camera are the same object at two widths.
  capture: {
    width: DOCK_HEIGHT,
    height: DOCK_HEIGHT,
    borderRadius: DOCK_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
})
