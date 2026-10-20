/**
 * «Nutrición del programa» on an Allfit programme's detail (PN-1).
 *
 * The energy in the display face with what it is for, and the three macros in small
 * tiles, each ring showing the share of the energy it carries — the same rings and
 * colours as Comida, so the goal reads the same here and where it will be followed.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { StyleSheet, View } from 'react-native'

import type { ProgramNutritionCopy } from '../client/program-nutrition'
import { CardGlow, FIGURE_TRACKING, macroColor, Ring } from './nutrition-ui'

export function ProgramNutritionCard({ copy }: { readonly copy: ProgramNutritionCopy }) {
  const theme = useTheme()
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text role="eyebrow" size="2xs" color="muted">
          NUTRICIÓN DEL PROGRAMA
        </Text>
        <Text role="control" size="xs" color="muted">
          Ajustada a tu peso
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`${copy.energy} kcal al día. ${copy.purpose}. ${copy.macros
          .map((macro) => `${macro.label} ${macro.value}`)
          .join(', ')}`}
        style={[
          styles.card,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        <CardGlow />
        <View style={styles.energy}>
          <Text role="display" tracking={FIGURE_TRACKING} size="3xl">
            {copy.energy}
          </Text>
          <Text role="control" size="sm" color="secondary" style={styles.unit}>
            kcal al día
          </Text>
        </View>
        <Text role="body" size="sm" color="secondary">
          {copy.purpose}
        </Text>
        <View style={styles.macros}>
          {copy.macros.map((macro) => (
            <View
              key={macro.code}
              style={[styles.macro, { backgroundColor: theme.color.background.surfaceMuted }]}
            >
              <Ring
                size={30}
                stroke={4}
                share={macro.share}
                color={macroColor(theme, macro.code)}
              />
              <View>
                <Text role="data" size="md">
                  {macro.value}
                </Text>
                <Text role="control" size="2xs" style={{ color: macroColor(theme, macro.code) }}>
                  {macro.label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { gap: 4, borderRadius: 22, borderWidth: 1, padding: 18, overflow: 'hidden' },
  energy: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  unit: { paddingBottom: 4 },
  macros: { flexDirection: 'row', gap: 8, marginTop: 12 },
  macro: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
})
