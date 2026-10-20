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
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'

import type { MealType, NutrientCode, NutritionMeal, Totals } from '../client/nutrition'
import { useMealPhoto } from './use-meal-photo'

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
 * The day against an energy range as a ring (NE-2), the same shape as the card for an
 * exact goal beside it.
 *
 * The stretch between the minimum and the maximum is lit on the track, with a thin rim
 * outside it, so the range reads as a place on the ring and not as two numbers to compare.
 * What was eaten fills over it from the top. Past the maximum the fill turns to the warning
 * colour: over is information, not a fault.
 */
export function ZoneRing({
  size,
  stroke,
  eatenAt,
  lowAt,
  highAt,
  over,
  children,
}: {
  readonly size: number
  readonly stroke: number
  /** Where the eaten, the minimum and the maximum fall around the ring, from 0 to 1. */
  readonly eatenAt: number
  readonly lowAt: number
  readonly highAt: number
  readonly over: boolean
  readonly children?: React.ReactNode
}) {
  const theme = useTheme()
  const rim = 2
  const gap = 3
  const box = size + 2 * (gap + rim)
  const centre = box / 2
  const radius = (size - stroke) / 2
  const outer = size / 2 + gap + rim / 2
  // A stretch of a circle as a dash, measured from the top because the drawing turns -90°.
  const dash = (r: number, from: number, to: number) => {
    const length = 2 * Math.PI * r
    return {
      strokeDasharray: `${String(Math.max(0, to - from) * length)} ${String(length)}`,
      strokeDashoffset: -from * length,
    }
  }
  const accent = theme.color.icon.accent
  return (
    <View style={{ width: box, height: box }}>
      <Svg width={box} height={box} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={theme.color.background.surfaceMuted}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={`${accent}40`}
          strokeWidth={stroke}
          fill="none"
          {...dash(radius, lowAt, highAt)}
        />
        <Circle
          cx={centre}
          cy={centre}
          r={outer}
          stroke={`${accent}99`}
          strokeWidth={rim}
          strokeLinecap="round"
          fill="none"
          {...dash(outer, lowAt, highAt)}
        />
        {eatenAt > 0 ? (
          <Circle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={over ? theme.color.status.warning : accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            {...dash(radius, 0, eatenAt)}
          />
        ) : null}
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View> : null}
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
  readonly meal: Pick<NutritionMeal, 'id' | 'photo' | 'meal_type'>
  readonly size: number
}) {
  const theme = useTheme()
  // A photo still on its way up is drawn from the phone, so the meal never shows bare.
  const pending = useMealPhoto(meal.id)
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
      {pending ? (
        <Image source={pending.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : meal.photo ? (
        <Image source={meal.photo.url} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <FoundationIcon
          name={MEAL_ICON[meal.meal_type]}
          customSize={size * 0.42}
          color={theme.color.icon.secondary}
          decorative
        />
      )}
      {pending?.kind === 'failed' ? (
        <View
          style={[styles.thumbFailed, { backgroundColor: theme.color.status.warning }]}
          accessibilityLabel="La foto no se pudo subir"
        >
          <FoundationIcon
            name="error"
            customSize={12}
            color={theme.color.background.canvas}
            decorative
          />
        </View>
      ) : null}
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
  thumbFailed: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 7, height: 7, borderRadius: 2 },
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
})
