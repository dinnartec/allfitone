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
 * A screen with no `confirmLabel` draws no confirm. The disabled circle is there to
 * say «there is something to press once you have chosen», and where the choice *is*
 * the tap — substituting one exercise for another — it promises a step that does not
 * exist.
 *
 * `confirmText` is the exception, for the screens where the act is not the same
 * every time. Adding three exercises is not the same as adding one, and a circle
 * cannot say which — so those screens draw the count instead of a tick. It is a
 * separate string from `confirmLabel` because the two have different jobs: the label
 * is the whole sentence a screen reader says, and what is drawn has to fit beside a
 * title at a size somebody can read.
 *
 * **Both shapes are the library's, not this file's.** This header drew its own
 * rounded rectangle with a flat `action.primary`, while `Button` painted its primary
 * variant with `gradient.signal` — so the same affirmative act looked one way here
 * and another everywhere else, which is exactly what a hand-built control costs.
 *
 * **One face for every title, and it is not the condensed one.** A section label and
 * somebody's own routine name briefly had separate treatments here — caps for the
 * app's words, sentence case for theirs. It read as two headers rather than one, and
 * the seam showed a single tap apart: «Añadir ejercicio» in condensed caps, opened
 * from a routine whose own name sat in the control face. Uppercase display is for
 * editorial moments, not for the line that says where you are.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

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
  /** Absent draws no confirm at all, for a screen where the choice is the tap itself. */
  readonly confirmLabel?: string | undefined
  /** Drawn instead of the tick, for a confirm that changes with the set. */
  readonly confirmText?: string | undefined
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
          <Text role="control" size="xl" accessibilityRole="header" style={styles.title}>
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
        <Text role="body" size="sm" color="muted">
          {subtitle}
        </Text>
      </View>
      {confirmLabel === undefined ? null : confirmText === undefined ? (
        <IconButton
          icon="check"
          variant="solid"
          accessibilityLabel={confirmLabel}
          disabled={!ready}
          onPress={onConfirm}
        />
      ) : (
        <Button
          label={confirmText}
          accessibilityLabel={confirmLabel}
          disabled={!ready}
          onPress={onConfirm}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1 },
})
