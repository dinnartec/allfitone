/**
 * The pieces every nutrition screen draws alike (N-1e to N-6).
 *
 * **One colour per macro, from the Design System's discipline hues**: protein cyan,
 * carbohydrates amber, fat violet. The same three everywhere — a dot, a ring, a bar —
 * so a macro is recognised by its colour before its name is read.
 */

import { FoundationIcon, iconCatalog, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'

import type { MealType, NutrientCode, NutritionMeal, Totals } from '../client/nutrition'

type Theme = ReturnType<typeof useTheme>

/**
 * Figures in the display and poster roles touch at the roles' tight tracking (DS
 * `tracking`): a kcal total reads as one blot. Opened just enough to separate digits.
 */
export const FIGURE_TRACKING = 0.01

/**
 * A food icon by name, or the plate when this build's Design System has not got it: the
 * food set is newer than the published package's types, so the name is checked at runtime.
 */
export function foodIcon(name: string): IconName {
  return isIconName(name) ? name : 'nutrition'
}

const isIconName = (name: string): name is IconName => Object.hasOwn(iconCatalog, name)

export function macroColor(theme: Theme, code: NutrientCode): string {
  switch (code) {
    case 'protein':
      return theme.color.discipline.strength
    case 'carbohydrates':
      return theme.color.discipline.highIntensity
    case 'fat':
      return theme.color.discipline.rhythm
    case 'fiber':
      return theme.color.discipline.wellbeing
    case 'water':
      return theme.color.status.info
    case 'energy':
      return theme.color.icon.accent
    default:
      // The detail, vitamins and minerals read as one quiet family beside the macros.
      return theme.color.icon.secondary
  }
}

/** A share of something as an arc: the day eaten, a macro against its goal. */
export function Ring({
  size,
  stroke,
  share,
  color,
  children,
}: {
  readonly size: number
  readonly stroke: number
  readonly share: number
  readonly color: string
  readonly children?: React.ReactNode
}) {
  const theme = useTheme()
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(1, share)) * length
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.color.background.surfaceMuted}
          strokeWidth={stroke}
          fill="none"
        />
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${String(filled)} ${String(length)}`}
            fill="none"
          />
        ) : null}
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View> : null}
    </View>
  )
}

/**
 * The day against an energy range, on a shallow arc (N-1g).
 *
 * A ring answers «how far to the goal», and a range has two goals. The arc fills with
 * what was eaten and lights the stretch between the minimum and the maximum, both ends
 * marked with their figures underneath, so the day reads as below, inside or past the
 * range at a glance. Shallow, not a half circle: a half circle as wide as the card stood
 * three times taller than the card for an exact goal and pushed the day off the screen.
 * Past the maximum the fill turns to the warning colour: over is information, not a fault.
 */
export function RangeArc({
  width,
  eatenAt,
  lowAt,
  highAt,
  lowLabel,
  highLabel,
  over,
}: {
  readonly width: number
  /** Where the eaten, the minimum and the maximum fall along the arc, from 0 to 1. */
  readonly eatenAt: number
  readonly lowAt: number
  readonly highAt: number
  readonly lowLabel: string
  readonly highLabel: string
  readonly over: boolean
}) {
  const theme = useTheme()
  const stroke = 10
  const rise = 34
  const chord = width - stroke
  // The circle whose arc spans the chord with that rise.
  const r = (chord * chord) / 4 / (2 * rise) + rise / 2
  const span = 2 * Math.asin(chord / 2 / r)
  const cx = width / 2
  const cy = stroke / 2 + r
  const at = (f: number) => {
    const angle = Math.PI / 2 + span / 2 - span * Math.min(1, Math.max(0, f))
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) }
  }
  const arc = (from: number, to: number) => {
    const a = at(from)
    const b = at(to)
    return `M ${String(a.x)} ${String(a.y)} A ${String(r)} ${String(r)} 0 0 1 ${String(b.x)} ${String(b.y)}`
  }
  // The marks sit where the arc is high, so their figures fit above its lowest ends.
  const height = rise + stroke + 4
  const marks = [
    { f: lowAt, label: lowLabel },
    { f: highAt, label: highLabel },
  ]
  return (
    <View
      style={{ width, height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height}>
        <Path
          d={arc(0, 1)}
          stroke={theme.color.background.surfaceMuted}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={arc(lowAt, highAt)}
          stroke={`${theme.color.icon.accent}55`}
          strokeWidth={stroke}
          fill="none"
        />
        {eatenAt > 0 ? (
          <Path
            d={arc(0, eatenAt)}
            stroke={over ? theme.color.status.warning : theme.color.icon.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        {marks.map(({ f, label }) => {
          const p = at(f)
          return <Circle key={label} cx={p.x} cy={p.y} r={3.5} fill={theme.color.text.primary} />
        })}
      </Svg>
      {marks.map(({ f, label }) => {
        const p = at(f)
        return (
          <Text
            key={label}
            role="body"
            size="2xs"
            color="secondary"
            style={[styles.arcMark, { left: p.x - 24, top: p.y + stroke / 2 + 4 }]}
          >
            {label}
          </Text>
        )
      })}
    </View>
  )
}

/** «■ 12 g ■ 78 g ■ 6 g»: a meal's three macros, each in its colour, those it has. */
export function MacroDots({ totals }: { readonly totals: Totals }) {
  const theme = useTheme()
  const shown = (['protein', 'carbohydrates', 'fat'] as const).filter(
    (code) => totals[code] !== undefined,
  )
  return (
    <View style={styles.dots}>
      {shown.map((code) => (
        <View key={code} style={styles.dot}>
          <View style={[styles.swatch, { backgroundColor: macroColor(theme, code) }]} />
          <Text role="body" size="sm" color="secondary">
            {`${String(Math.round(totals[code] ?? 0))} g`}
          </Text>
        </View>
      ))}
    </View>
  )
}

const MEAL_ICON: Readonly<Record<MealType, 'morning' | 'nutrition' | 'evening' | 'energy'>> = {
  breakfast: 'morning',
  lunch: 'nutrition',
  dinner: 'evening',
  snack: 'energy',
  other: 'nutrition',
}

/** The meal's photo, or the icon of its kind on a quiet tile. */
export function MealThumb({
  meal,
  size,
}: {
  readonly meal: Pick<NutritionMeal, 'photo' | 'meal_type'>
  readonly size: number
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.thumb,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: theme.color.background.surfaceMuted,
        },
      ]}
    >
      {meal.photo ? (
        <Image source={meal.photo.url} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <FoundationIcon
          name={MEAL_ICON[meal.meal_type]}
          customSize={size * 0.42}
          color={theme.color.icon.secondary}
          decorative
        />
      )}
    </View>
  )
}

export { MEAL_ICON }

/**
 * The accent's soft glow behind a hero figure (R-0): a radial fade from the accent at 12 %
 * to nothing, cut by the card. Decoration only, so it is hidden from assistive tech.
 */
export function CardGlow({
  size = 220,
  right = -70,
  top = -60,
}: {
  readonly size?: number
  readonly right?: number
  readonly top?: number
}) {
  const theme = useTheme()
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glow, { width: size, height: size, right, top }]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={theme.color.icon.accent} stopOpacity={0.12} />
            <Stop offset="1" stopColor={theme.color.icon.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#glow)" />
      </Svg>
    </View>
  )
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

/**
 * The «+» of the next meal, inviting the tap (R-0): a fixed accent ring around it, and a
 * wave that leaves it every 1.8 s, as the live session's dot does. Reduced motion keeps
 * the ring and drops the wave.
 */
export function PulsingPlus({
  size = 44,
  children,
}: {
  readonly size?: number
  readonly children: ReactNode
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const wave = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    wave.set(withRepeat(withTiming(1, { duration: 1800, easing: EASE_OUT }), -1, false))
  }, [reduced, wave])
  const leaving = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - wave.get()),
    transform: [{ scale: 1 + wave.get() * 0.45 }],
  }))
  const ring = size + 16
  const around = {
    width: ring,
    height: ring,
    borderRadius: ring / 2,
    borderColor: theme.color.icon.accent,
  }
  return (
    <View style={[styles.plusWrap, { width: ring, height: ring }]}>
      {reduced ? null : (
        <Animated.View pointerEvents="none" style={[styles.plusRing, around, leaving]} />
      )}
      <View
        pointerEvents="none"
        style={[styles.plusRing, around, { backgroundColor: theme.color.accent.tonal }]}
      />
      <View
        style={[
          styles.plusCore,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.color.icon.accent,
          },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
  plusWrap: { alignItems: 'center', justifyContent: 'center' },
  plusRing: { position: 'absolute', borderWidth: 2 },
  plusCore: { alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  arcMark: { position: 'absolute', width: 48, textAlign: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 7, height: 7, borderRadius: 2 },
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
})
