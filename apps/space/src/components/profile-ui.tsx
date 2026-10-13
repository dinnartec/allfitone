/**
 * The pieces the profile tab (`PF-1`) is built from: a labelled group of rows, the row,
 * and the plan card at the top.
 *
 * Every row has the same three parts — a glyph in a quiet square, a title with the one
 * fact under it, and what is at the end. The end says what the row does: a chevron opens
 * something, «Activo» states a fact, and «Pronto» marks a part of the account that is
 * not built yet. A row that cannot open anything never pretends it can.
 */

import type { IconName } from '@allfitone/icons'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { LinearGradient } from 'expo-linear-gradient'
import { Children, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { SectionLabel } from './pro-ui'

const PRO_CARD = ['#0E3B45', '#08141C'] as const
const FREE_CARD = ['#13222B', '#0A131A'] as const

/** A section of the profile: its name, then its rows in one panel. */
export function ProfileGroup({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={styles.group}>
      <SectionLabel>{label}</SectionLabel>
      <View
        style={[
          styles.panel,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        {Children.toArray(children).map((row, index) => (
          <View
            key={index}
            style={index > 0 && { borderTopWidth: 1, borderTopColor: theme.color.border.subtle }}
          >
            {row}
          </View>
        ))}
      </View>
    </View>
  )
}

export type RowEnd = 'open' | 'soon' | 'active' | 'none'

const END_LABEL: Record<RowEnd, string> = { open: '', soon: 'Pronto', active: 'Activo', none: '' }

export function ProfileRow({
  icon,
  title,
  caption,
  end,
  alert,
  onPress,
}: {
  readonly icon: IconName
  readonly title: string
  readonly caption?: string | undefined
  readonly end: RowEnd
  /** Tints the glyph: for the one row about pain, which is health data. */
  readonly alert?: boolean
  readonly onPress?: (() => void) | undefined
}) {
  const theme = useTheme()
  const opens = end === 'open' && onPress !== undefined
  const body = (
    <>
      <View style={[styles.glyph, { backgroundColor: theme.color.background.surfaceMuted }]}>
        <FoundationIcon
          name={icon}
          size="sm"
          color={alert ? theme.color.status.danger : theme.color.icon.secondary}
          decorative
        />
      </View>
      <View style={styles.grow}>
        <Text role="control" size="sm">
          {title}
        </Text>
        {caption ? (
          <Text role="body" size="xs" color="muted">
            {caption}
          </Text>
        ) : null}
      </View>
      {end === 'open' ? (
        <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
      ) : end === 'soon' ? (
        <Text role="control" size="2xs" color="muted">
          Pronto
        </Text>
      ) : end === 'none' ? null : (
        <View style={[styles.active, { backgroundColor: `${theme.color.status.success}24` }]}>
          <View style={[styles.dot, { backgroundColor: theme.color.status.success }]} />
          <Text role="control" size="xs" color="success">
            Activo
          </Text>
        </View>
      )}
    </>
  )

  if (!opens) {
    return (
      <View
        accessible
        accessibilityLabel={[title, caption, END_LABEL[end]].filter(Boolean).join('. ')}
        style={styles.row}
      >
        {body}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}. ${caption}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  )
}

/** The plan at the top of the profile, the one row drawn as a card. */
export function PlanCard({
  pro,
  caption,
  onPress,
}: {
  readonly pro: boolean
  readonly caption: string
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const title = pro ? 'Allfit Pro' : 'Plan gratis'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: pro ? theme.color.accent.tonalBorder : theme.color.border.subtle },
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={pro ? PRO_CARD : FREE_CARD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.seal,
          {
            backgroundColor: theme.color.background.canvas,
            borderColor: pro ? theme.color.accent.tonalBorder : theme.color.border.subtle,
          },
        ]}
      >
        <FoundationIcon
          name={pro ? 'favourite' : 'person'}
          size="md"
          color={pro ? theme.color.icon.accent : theme.color.icon.secondary}
          decorative
        />
      </View>
      <View style={styles.grow}>
        <Text role="control" size="md">
          {title}
        </Text>
        <Text role="control" size="xs" color={pro ? 'accent' : 'muted'}>
          {caption}
        </Text>
      </View>
      <FoundationIcon
        name="next"
        size="sm"
        color={pro ? theme.color.icon.accent : theme.color.icon.secondary}
        decorative
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  panel: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 10 },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, gap: 2 },
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 16,
  },
  seal: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
})
