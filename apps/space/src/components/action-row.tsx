/**
 * One action in a sheet: an icon on its tile, what it does, and what that means (FIN-18b).
 *
 * `SheetChoice` answers «which one»; this answers «what to do», so it leads with the
 * icon the action is recognised by. A destructive one carries the danger ink and ground
 * on the whole row, so it reads as different before it is read at all.
 */

import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

export function ActionRow({
  icon,
  name,
  detail,
  danger = false,
  onPress,
}: {
  readonly icon: IconName
  readonly name: string
  readonly detail: string
  readonly danger?: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const ink = danger ? theme.color.status.danger : theme.color.icon.primary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={detail}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: danger
            ? `${theme.color.status.danger}14`
            : theme.color.background.surfaceSubtle,
          borderColor: danger ? `${theme.color.status.danger}55` : theme.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.tile,
          {
            backgroundColor: danger
              ? `${theme.color.status.danger}26`
              : theme.color.background.surfaceMuted,
          },
        ]}
      >
        <FoundationIcon name={icon} size="sm" color={ink} decorative />
      </View>
      <View style={styles.text}>
        <Text
          role="control"
          size="md"
          {...(danger ? { style: { color: theme.color.status.danger } } : {})}
        >
          {name}
        </Text>
        <Text role="body" size="sm" color="muted">
          {detail}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tile: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
})
