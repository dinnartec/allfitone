/**
 * One option in a sheet: a name, what it means, and whether it is the current one.
 *
 * Shared by the routine editor and the session in progress, which ask the same
 * questions — what kind of set, how long to rest — and should answer them alike.
 */

import { Badge, type BadgeTone } from '@allfitone/react-native/badge'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

export function SheetChoice({
  name,
  detail,
  shape,
  tone,
  selected,
  disabled,
  edge,
  onPress,
}: {
  readonly name: string
  /** Absent leaves the name alone, for a list where the name is the whole answer. */
  readonly detail?: string
  readonly shape?: string
  /** Draws the name as its badge instead of as a word, for a choice that has one. */
  readonly tone?: BadgeTone
  readonly selected?: boolean
  readonly disabled?: boolean
  /** A rule down the leading edge, for a choice that already belongs to something. */
  readonly edge?: string | undefined
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      {...(detail === undefined ? {} : { accessibilityHint: detail })}
      accessibilityState={{ selected: selected ?? false, disabled: disabled ?? false }}
      disabled={disabled ?? false}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? theme.color.border.accent : theme.color.border.subtle,
          backgroundColor: theme.color.background.surface,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
        edge === undefined ? null : { borderLeftWidth: 3, borderLeftColor: edge },
      ]}
    >
      <View style={styles.choiceText}>
        {tone === undefined ? (
          <Text role="control" size="md">
            {name}
          </Text>
        ) : (
          <Badge label={name} tone={tone} />
        )}
        {detail === undefined ? null : (
          <Text role="body" size="sm" color="muted">
            {detail}
          </Text>
        )}
      </View>
      {shape === undefined ? null : (
        <Text role="body" size="sm" color="accent">
          {shape}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  choiceText: { flex: 1, gap: 2 },
})
