/**
 * The header every content editor shares: close, title, and the one confirm.
 *
 * `V-H`, `V-E1`, `V-G` and `PR-1` draw the same three things and differ only in what
 * the title says and whether the confirm is available. Built once because four copies
 * of a header is four places for the disabled state to drift.
 *
 * The confirm is a circle and not a word: it is the same act on every one of these
 * screens, and a circle at the top right is where both platforms put it.
 *
 * `confirmText` is the exception, for the screens where the act is not the same
 * every time. Adding three exercises is not the same as adding one, and a circle
 * cannot say which — so those screens draw the count instead of a tick.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

const CONFIRM = 34

export function ScreenHeader({
  title,
  subtitle,
  onClose,
  onConfirm,
  confirmLabel,
  confirmText,
  editable,
  onEdit,
}: {
  readonly title: string
  readonly subtitle: string
  readonly onClose: () => void
  readonly onConfirm?: (() => void) | undefined
  readonly confirmLabel: string
  /** Draws the label instead of the tick, for a confirm that changes with the set. */
  readonly confirmText?: boolean | undefined
  readonly editable?: boolean | undefined
  readonly onEdit?: (() => void) | undefined
}) {
  const theme = useTheme()
  const ready = onConfirm !== undefined

  return (
    <View style={styles.row}>
      <IconButton icon="close" accessibilityLabel="Cerrar" onPress={onClose} />
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <Text role="display" size="xl" uppercase accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cambiar el nombre"
              onPress={onEdit}
            >
              <FoundationIcon name="edit" size="sm" color={theme.color.icon.secondary} decorative />
            </Pressable>
          ) : null}
        </View>
        <Text role="body" size="xs" color="muted">
          {subtitle}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={onConfirm}
        style={({ pressed }) => [
          confirmText ? styles.confirmWide : styles.confirm,
          {
            backgroundColor: ready ? theme.color.action.primary : theme.color.background.surface,
            borderColor: ready ? theme.color.border.accent : theme.color.border.subtle,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        {confirmText ? (
          <Text
            role="display"
            size="sm"
            uppercase
            numberOfLines={1}
            style={{
              color: ready ? theme.color.action.onPrimary : theme.color.text.muted,
            }}
          >
            {confirmLabel}
          </Text>
        ) : (
          <FoundationIcon
            name="check"
            size="sm"
            color={ready ? theme.color.action.onPrimary : theme.color.icon.secondary}
            decorative
          />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1 },
  confirmWide: {
    minHeight: CONFIRM,
    minWidth: CONFIRM,
    paddingHorizontal: 16,
    borderRadius: CONFIRM / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: {
    width: CONFIRM,
    height: CONFIRM,
    borderRadius: CONFIRM / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
