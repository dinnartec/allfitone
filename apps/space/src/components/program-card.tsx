/**
 * A program as both screens show it: the first-day cards and the full catalogue.
 *
 * One component rather than two nearly identical ones. The canvases differ by a few
 * pixels and by the badge's wording, and a copy would have drifted the moment either
 * screen changed — which is exactly how the two ended up disagreeing about what a
 * suggestion means the first time this was built.
 *
 * The zones are the emphasis the version was published with. They are not decoration:
 * they are what the person declared in the onboarding, coming back to them as the
 * reason this program is here.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

import { programCaption, type ProgramSummary } from '../client/program-catalogue'

const ZONE_LABEL: Record<string, string> = {
  chest: 'Pecho',
  back: 'Espalda',
  shoulders: 'Hombros',
  arms: 'Brazos',
  abs: 'Abdomen',
  glutes: 'Glúteos',
  legs: 'Piernas',
  whole_body: 'Todo el cuerpo',
}

export interface ProgramCardProps {
  readonly program: ProgramSummary
  readonly suggested: boolean
  /** Shorter where the card is one of many; the canvas says so on each screen. */
  readonly badge?: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly onPress: () => void
}

export function ProgramCard({
  program,
  suggested,
  badge = 'SUGERIDO PARA TI',
  busy,
  disabled,
  onPress,
}: ProgramCardProps) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${program.title}. ${programCaption(program)}. ${program.weeks} semanas${
        suggested ? '. Sugerido para ti' : ''
      }`}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: suggested ? theme.color.border.accent : theme.color.border.subtle,
          borderWidth: suggested ? 2 : 1.5,
          opacity: disabled && !busy ? 0.5 : 1,
        },
      ]}
    >
      {suggested ? (
        <View style={[styles.badge, { backgroundColor: theme.color.action.primary }]}>
          <Text role="eyebrow" size="2xs" style={{ color: theme.color.action.onPrimary }}>
            {badge}
          </Text>
        </View>
      ) : null}

      <View style={[styles.body, suggested ? styles.belowBadge : null]}>
        <View style={styles.copy}>
          <Text role="display" size="lg" uppercase>
            {program.title}
          </Text>
          <Text role="body" size="sm" color="muted">
            {programCaption(program)}
          </Text>
          <View style={styles.zones}>
            {program.emphases.map((zone) => (
              <View
                key={zone}
                style={[
                  styles.zone,
                  {
                    backgroundColor: theme.color.accent.tonal,
                    borderColor: theme.color.accent.tonalBorder,
                  },
                ]}
              >
                <Text role="label" size="2xs" color="accent">
                  {ZONE_LABEL[zone] ?? zone}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.aside}>
          <Text role="display" size="lg" color={busy ? 'muted' : 'primary'}>
            {busy ? '…' : `${program.weeks} sem`}
          </Text>
          <FoundationIcon name="next" size="sm" color={theme.color.icon.accent} decorative />
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, gap: 10, minHeight: 44 },
  // Hangs from the top edge with only its bottom corners rounded, sitting on the
  // border rather than inside the padding.
  badge: {
    position: 'absolute',
    top: 0,
    left: 14,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  belowBadge: { marginTop: 10 },
  copy: { flex: 1, gap: 6 },
  aside: { alignItems: 'flex-end', gap: 8 },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  zone: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
})
