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
import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import {
  BAR_PADDING,
  DOCK_HEIGHT,
  dockBottom,
  dropMaterial,
  dropOffset,
  nearestTab,
  onDrop,
  stretchFor,
  tabAt,
} from '../client/dock'

/** The canvas's floating bar, and the room the content has to leave under it. */
export { DOCK_HEIGHT }
// Más pegada a los bordes que cuando la cámara le robaba setenta puntos: con cuatro
// destinos cada columna necesita todo el ancho que la pantalla pueda dar.
const DOCK_INSET = 8
// Liquid Glass is iOS 26's; asked once, since the answer does not change while the app runs.
const LIQUID_GLASS = isLiquidGlassAvailable()
/** How much canvas the veil lays over the glass: enough for the labels to read first. */
const VEIL = 0.6
// The drop travels on a spring, and its shape answers on a looser one: it lands and keeps
// quivering a moment, wider then taller, the way a drop of water settles.
const TRAVEL = { duration: 460, dampingRatio: 0.82, reduceMotion: ReduceMotion.System }
const LANDING = { duration: 420, dampingRatio: 0.6, reduceMotion: ReduceMotion.System }
const JELLY = { duration: 760, dampingRatio: 0.3, reduceMotion: ReduceMotion.System }
// The tail trails the drop on a softer spring, so fast moves pull it out and it rejoins.
const TAIL = { duration: 560, dampingRatio: 0.6, reduceMotion: ReduceMotion.System }
// Held, the drop swells like a lens lifted off the bar; let go, it wobbles back down.
const GRAB = { duration: 260, dampingRatio: 0.62, reduceMotion: ReduceMotion.System }
const RELEASE = { duration: 520, dampingRatio: 0.38, reduceMotion: ReduceMotion.System }
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
// How wide and how flat a drop gets at full stretch, how much it swells when held, and
// the tail's size beside it.
const STRETCH_X = 0.26
const STRETCH_Y = 0.12
const SWELL = 0.14
const TAIL_SHARE = 0.6

const tick = () => void Haptics.selectionAsync()
const press = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)

/** Whether the person asked the system for less transparency; it can change while open. */
function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let live = true
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => live && setReduce(value))
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce)
    return () => {
      live = false
      subscription.remove()
    }
  }, [])
  return reduce
}

export type TabKey = 'today' | 'train' | 'food' | 'profile'

export interface TabBarProps {
  /** The destinations, already wrapped in whatever the router needs. */
  readonly children: ReactNode
  /** Which destination is current, where the drop rests; -1 when none is. */
  readonly active: number
  readonly count: number
  /** Where a drop dragged along the bar and let go lands; the layout navigates there. */
  readonly onSelect: (index: number) => void
}

/**
 * The bar, with one drop of glass over the current destination.
 *
 * **One drop, not one per tab.** It travels from the tab it leaves to the tab it reaches,
 * stretching as it goes and settling with a little give, which is what makes it read as
 * liquid. It can also be dragged along the bar: it follows the finger, stretches with the
 * speed, ticks as it crosses each destination, and lands on the nearest one when let go.
 * A tap still goes to the tab under it; a drag only begins past a few points sideways.
 */
export function TabBar({ children, active, count, onSelect }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  const reduced = useReducedMotion()
  const material = dropMaterial({
    liquidGlass: LIQUID_GLASS,
    reduceTransparency: useReduceTransparency(),
  })
  const [width, setWidth] = useState(0)
  const offset = useSharedValue(0)
  const stretch = useSharedValue(0)
  const origin = useSharedValue(0)
  const over = useSharedValue(active)
  const tail = useSharedValue(0)
  const lift = useSharedValue(0)
  const holding = useSharedValue(false)
  // The tab a tap already sent the drop to, so the navigation arriving later does not resend it.
  const steered = useSharedValue(-1)

  // The tail always chases the drop, wherever the drop is being taken.
  useAnimatedReaction(
    () => offset.get(),
    (now) => {
      tail.set(reduced ? now : withSpring(now, TAIL))
    },
  )
  // The first placement does not travel, and a drop that landed by dragging is already home.
  const placed = useRef(false)
  const landedByDrag = useRef(false)

  useEffect(() => {
    if (width === 0 || active < 0) return
    over.set(active)
    const target = dropOffset(active, width, count)
    if (!placed.current || reduced) {
      placed.current = true
      offset.set(target)
      return
    }
    if (landedByDrag.current) {
      landedByDrag.current = false
      return
    }
    if (steered.get() === active) {
      steered.set(-1)
      return
    }
    offset.set(withSpring(target, TRAVEL))
    stretch.set(
      withSequence(withTiming(0.7, { duration: 140, easing: EASE_OUT }), withSpring(0, JELLY)),
    )
  }, [active, width, count, reduced, offset, stretch, over, steered])

  const column = width > 0 ? (width - BAR_PADDING * 2) / count : 0
  // Read when a drag lands, so the gestures need not be rebuilt each time they change.
  const latest = useRef({ active, onSelect })
  useEffect(() => {
    latest.current = { active, onSelect }
  }, [active, onSelect])
  const land = useCallback((index: number) => {
    const { active: current, onSelect: select } = latest.current
    landedByDrag.current = index !== current
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (index !== current) select(index)
  }, [])

  // Built once per bar size: rebuilt on every render, the gesture handlers were attached
  // again on the UI thread at each tab switch, right while the drop was in flight.
  const gesture = useMemo(() => {
    // The drop answers a tap on the UI thread, the moment the finger lifts. Waiting for the
    // new screen to render first is what made the bar react seconds late.
    const tap = Gesture.Tap()
      .enabled(width > 0)
      .maxDuration(2000)
      .onEnd((event, success) => {
        const tab = tabAt(event.x, width, count)
        if (!success || tab === over.get()) return
        over.set(tab)
        steered.set(tab)
        scheduleOnRN(tick)
        if (reduced) {
          offset.set(dropOffset(tab, width, count))
          return
        }
        offset.set(withSpring(dropOffset(tab, width, count), TRAVEL))
        stretch.set(
          withSequence(withTiming(0.7, { duration: 140, easing: EASE_OUT }), withSpring(0, JELLY)),
        )
      })

    const drag = Gesture.Pan()
      .enabled(width > 0)
      .activeOffsetX([-10, 10])
      .onBegin((event) => {
        // Only a finger on the drop lifts it; a tap on another tab just goes there.
        if (reduced || !onDrop(event.x, offset.get(), column - 4)) return
        holding.set(true)
        lift.set(withSpring(1, GRAB))
        scheduleOnRN(press)
      })
      .onStart(() => {
        origin.set(offset.get())
      })
      .onUpdate((event) => {
        // A little past either end, as a drop pulled against an edge gives before it stops.
        const first = dropOffset(0, width, count) - 10
        const last = dropOffset(count - 1, width, count) + 10
        const next = Math.min(last, Math.max(first, origin.get() + event.translationX))
        offset.set(next)
        stretch.set(reduced ? 0 : stretchFor(event.velocityX))
        const tab = nearestTab(next, width, count)
        if (tab !== over.get()) {
          over.set(tab)
          scheduleOnRN(tick)
        }
      })
      .onEnd((event) => {
        const tab = nearestTab(offset.get(), width, count)
        offset.set(
          withSpring(dropOffset(tab, width, count), { ...LANDING, velocity: event.velocityX }),
        )
        stretch.set(withSpring(0, JELLY))
        scheduleOnRN(land, tab)
      })
      .onFinalize(() => {
        if (!holding.get()) return
        holding.set(false)
        lift.set(withSpring(0, RELEASE))
      })

    return Gesture.Simultaneous(drag, tap)
  }, [width, count, column, reduced, land, offset, stretch, origin, over, lift, holding, steered])

  const moving = useAnimatedStyle(() => {
    // The jelly overshoots below zero, so the drop goes taller and narrower for a moment.
    const shape = Math.min(1, Math.max(-0.6, stretch.get()))
    return {
      transform: [
        { translateX: offset.get() },
        { scaleX: 1 + STRETCH_X * shape + SWELL * lift.get() },
        { scaleY: 1 - STRETCH_Y * shape + SWELL * lift.get() },
      ],
    }
  })
  const trailing = useAnimatedStyle(() => {
    // Seen only once it falls behind; at rest it sits inside the drop, merged with it.
    const apart = Math.abs(offset.get() - tail.get())
    const reach = column > 0 ? Math.min(1, apart / column) : 0
    return {
      opacity: Math.min(1, apart / 18),
      transform: [
        { translateX: tail.get() + ((column - 4) * (1 - TAIL_SHARE)) / 2 },
        { scaleX: 1 + 0.5 * reach },
        { scaleY: 1 - 0.18 * reach },
      ],
    }
  })

  return (
    <View style={[styles.dock, { bottom: dockBottom(insets.bottom) }]} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          style={styles.grow}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          <GlassPanel radius="action" style={styles.glass}>
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: withAlpha(theme.color.background.canvas, VEIL) },
              ]}
            />
            {column > 0 && active >= 0 ? (
              // Glass in one container melts together when close: drop and tail read as
              // one body that stretches, splits and joins again.
              <GlassContainer spacing={28} pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Animated.View
                  style={[styles.drop, { width: (column - 4) * TAIL_SHARE }, trailing]}
                >
                  <DropFill material={material} />
                </Animated.View>
                <Animated.View style={[styles.drop, { width: column - 4 }, moving]}>
                  <DropFill material={material} />
                </Animated.View>
              </GlassContainer>
            ) : null}
            {children}
          </GlassPanel>
        </View>
      </GestureDetector>
    </View>
  )
}

/** The drop's substance: interactive Liquid Glass, or a tint where there is none. */
function DropFill({ material }: { readonly material: 'glass' | 'tint' }) {
  const theme = useTheme()
  return material === 'glass' ? (
    <GlassView
      isInteractive
      colorScheme="dark"
      glassEffectStyle="regular"
      style={styles.dropFill}
    />
  ) : (
    <View
      style={[
        styles.dropFill,
        {
          backgroundColor: theme.color.accent.tonal,
          borderColor: theme.color.accent.tonalBorder,
          borderWidth: 1,
        },
      ]}
    />
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
  // Above the screens: they are stacked with z-indices of their own to dissolve.
  dock: {
    position: 'absolute',
    zIndex: 10,
    left: DOCK_INSET,
    right: DOCK_INSET,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  grow: { flex: 1 },
  // Clipped, so a drop bouncing off an end tab stays inside the bar's rounded edge.
  glass: {
    flex: 1,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BAR_PADDING,
    overflow: 'hidden',
  },
  // **Columnas iguales.** Se probó dejando que cada una midiera su palabra, para que
  // «Entrenamiento» cupiera entero: caber cabía, pero los iconos perdían el ritmo
  // —ciento noventa y tres puntos entre dos y ciento cincuenta y tres entre otros
  // dos— y una barra cuyos iconos no están a la misma distancia se lee rota. El
  // ritmo del icono manda sobre el largo de la palabra.
  // The whole height of the bar, so the drop wraps icon and word together.
  tab: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 3,
    minHeight: 44,
    justifyContent: 'center',
  },
  // The drop: a capsule inset from the bar, placed by its offset; untinted glass, so the
  // accent stays on the icon and the word and never reads as a stain.
  drop: { position: 'absolute', top: 7, bottom: 7, left: 2 },
  dropFill: { flex: 1, borderRadius: 28 },
})
