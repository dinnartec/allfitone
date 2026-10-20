/**
 * The energy card on Comida when the goal is a range (NE-2).
 *
 * The same shape as the card for an exact goal: the figure on the left, a ring on the
 * right, the accent's glow behind. The figure answers the question of the moment —
 * what is missing for the minimum, the margin left before the maximum, or by how much
 * the day went past it — and the ring shows where the range sits and how far the day
 * got. The range itself is said once, in the line under the figure.
 *
 * It replaced a shallow arc with two dots and their figures, which crowded the card and
 * repeated the range twice on an empty day.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { StyleSheet, View } from 'react-native'

import { rangeCardCopy, type GoalTarget, type RangeProgress } from '../client/nutrition'
import { CardGlow, FIGURE_TRACKING, ZoneRing } from './nutrition-ui'

export function RangeEnergyCard({
  goal,
  eaten,
  range,
}: {
  readonly goal: GoalTarget
  readonly eaten: number
  readonly range: RangeProgress
}) {
  const theme = useTheme()
  const copy = rangeCardCopy(goal, eaten, range)
  return (
    <View
      accessible
      accessibilityLabel={`${copy.figure} kcal. ${copy.line}. ${copy.detail}`}
      style={[
        styles.card,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <CardGlow />
      <View style={styles.grow}>
        <View style={styles.figure}>
          <Text role="display" tracking={FIGURE_TRACKING} size="5xl" style={styles.number}>
            {copy.figure}
          </Text>
          <Text role="control" size="md" color="secondary" style={styles.unit}>
            kcal
          </Text>
        </View>
        {/* The DS has no warning text colour; the excess takes the ring's own. */}
        <Text
          role="body"
          size="md"
          style={copy.over ? { color: theme.color.status.warning } : undefined}
        >
          {copy.line}
        </Text>
        <Text role="body" size="sm" color="muted">
          {copy.detail}
        </Text>
      </View>
      <ZoneRing
        size={104}
        stroke={10}
        eatenAt={range.eatenAt}
        lowAt={range.lowAt}
        highAt={range.highAt}
        over={copy.over}
      >
        <Text role="poster" tracking={FIGURE_TRACKING} size={copy.center.length > 5 ? 'lg' : 'xl'}>
          {copy.center}
        </Text>
        <Text role="body" size="xs" color="muted">
          {copy.centerLabel}
        </Text>
      </ZoneRing>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
  },
  grow: { flex: 1, gap: 4 },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  number: { paddingRight: 4 },
  unit: { paddingBottom: 8 },
})
