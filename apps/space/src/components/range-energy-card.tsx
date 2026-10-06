/**
 * The energy card on Comida when the goal is a range (N-1g).
 *
 * What was eaten over the range — «1.420 / 2.100–2.400 kcal» — and an arc that lights
 * the range and fills with the day. The card for an exact goal rings how much of it is
 * eaten; against a range that ring measured the maximum alone and said 980 kcal were
 * left when anything from 680 to 980 was right.
 *
 * Under the figure it says where the day stands: below the range, what is left as a
 * span; inside it, the room up to the maximum; past it, by how much.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import type { GoalTarget, RangeProgress } from '../client/nutrition'
import { CardGlow, FIGURE_TRACKING, RangeArc } from './nutrition-ui'

const kcal = (value: number) => Math.round(value).toLocaleString('es-CO')

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
  const [width, setWidth] = useState(0)
  const low = goal.minimum ?? 0
  const high = goal.maximum ?? 0
  // One sentence for where the day stands; the arc says it again in shape.
  const line =
    range.state === 'below'
      ? `Restante para hoy · ${kcal(range.fromLow)}–${kcal(range.fromHigh)} kcal`
      : range.state === 'within'
        ? `Dentro de tu meta · ${kcal(range.fromHigh)} kcal de margen`
        : `${kcal(range.over)} kcal por encima de tu meta`
  return (
    <View
      accessible
      accessibilityLabel={`Consumido ${kcal(eaten)} de una meta de ${kcal(low)} a ${kcal(high)} kcal. ${line}`}
      style={[
        styles.card,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <CardGlow />
      <View>
        <View style={styles.figure}>
          <Text role="display" tracking={FIGURE_TRACKING} size="4xl" style={styles.number}>
            {kcal(eaten)}
          </Text>
          <Text role="control" size="md" color="secondary" style={styles.unit}>
            {`/ ${kcal(low)}–${kcal(high)} kcal`}
          </Text>
        </View>
        <Text role="body" size="sm" color="secondary">
          {line}
        </Text>
      </View>
      <View style={styles.arc} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <RangeArc
            width={width}
            eatenAt={range.eatenAt}
            lowAt={range.lowAt}
            highAt={range.highAt}
            lowLabel={kcal(low)}
            highLabel={kcal(high)}
            over={range.state === 'above'}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 12, borderRadius: 24, borderWidth: 1, padding: 20, overflow: 'hidden' },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  number: { paddingRight: 4 },
  unit: { paddingBottom: 6 },
  arc: { alignSelf: 'stretch' },
})
