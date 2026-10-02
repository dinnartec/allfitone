/**
 * A finished session as the history shows it (H-2 on Hoy, H-6 on its own screen).
 *
 * One component for both because the two must never disagree about what a session
 * looks like: the row on Hoy is the same row the full history scrolls through, a few
 * points larger. `size` is the only difference, and it is the design's.
 *
 * **The thumbnail is the routine's cover**, the photograph Hoy and the share card show
 * for it, so a session looks the same wherever it appears. A trophy sits on its corner
 * when the session set a record. A free session has no routine and shows the bolt the
 * free-training offer uses, so the two read as the same thing.
 *
 * **Every line is a step of the type scale**, never a size of its own, so a row reads
 * at the same sizes as the rest of the app. The name is `md`: at the design's 20 a long
 * routine name was louder than what was done.
 *
 * **Ready for what has no data yet.** A session hidden from a gym and a coach's note
 * (ADR-037) take a `tag` beside the name and an `extra` line in muted ink; nothing sends
 * them today, and when something does, the row already knows where they go.
 */

import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { dayParts, historyDetail, recordsLine, type HistoryItem } from '../client/history'

/** Hoy's thumbnail is a step larger than the full list's, as H-2 and H-6 draw it. */
const SIZES = {
  home: { thumb: 58, radius: 16, badge: 20, row: 76 },
  list: { thumb: 54, radius: 15, badge: 19, row: 74 },
} as const

export type HistoryRowSize = keyof typeof SIZES

export interface HistoryTag {
  readonly label: string
  readonly icon?: IconName
}

/** The box a week's sessions sit in, with its rim and its ground. */
export function HistoryPanel({ children }: { readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      {children}
    </View>
  )
}

/** «SEMANA PASADA» on the left and, when it says something, «2 de 3» on the right. */
export function HistoryGroupHeader({
  label,
  tally,
  tallyAccent = false,
}: {
  readonly label: string
  readonly tally?: string
  readonly tallyAccent?: boolean
}) {
  return (
    <View style={styles.groupHeader} accessibilityRole="header">
      <Text role="eyebrow" size="xs" color="muted" uppercase>
        {label}
      </Text>
      {tally ? (
        <Text role="control" size="xs" color={tallyAccent ? 'accent' : 'secondary'}>
          {tally}
        </Text>
      ) : null}
    </View>
  )
}

export function HistoryRow({
  item,
  first,
  size,
  tag,
  extra,
  onPress,
}: {
  readonly item: HistoryItem
  /** The first in its panel has no rule above it: that rule is the panel's rim. */
  readonly first: boolean
  readonly size: HistoryRowSize
  readonly tag?: HistoryTag
  readonly extra?: string
  /** Opens the session's detail (FIN-18). */
  readonly onPress?: () => void
}) {
  const theme = useTheme()
  const measure = SIZES[size]
  const { weekday, day } = dayParts(item.trained_on)
  const records = recordsLine(item.record_count)
  const name = (item.title ?? (item.is_free ? 'Entreno libre' : 'Sesión')).toUpperCase()
  const detail = historyDetail(item)
  const below = records ?? extra

  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[name, detail, below, `${weekday} ${day}`].filter(Boolean).join(', ')}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.7 : 1 },
        {
          minHeight: measure.row,
          gap: 12,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border.subtle,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            width: measure.thumb,
            height: measure.thumb,
            borderRadius: measure.radius,
            backgroundColor: theme.color.background.surfaceMuted,
          },
        ]}
      >
        {item.thumbnail_url ? (
          <Image
            source={item.thumbnail_url}
            style={[StyleSheet.absoluteFill, { borderRadius: measure.radius }]}
            contentFit="cover"
          />
        ) : (
          <FoundationIcon
            name={item.is_free ? 'freestyle' : 'training'}
            customSize={22}
            color={theme.color.icon.accent}
            decorative
          />
        )}
        {item.record_count > 0 ? (
          <View
            style={[
              styles.badge,
              {
                width: measure.badge,
                height: measure.badge,
                borderRadius: measure.badge / 2,
                backgroundColor: theme.color.icon.accent,
                borderColor: theme.color.background.surface,
              },
            ]}
          >
            <FoundationIcon
              name="record"
              customSize={measure.badge / 2}
              color={theme.color.text.inverse}
              decorative
            />
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.title}>
          <Text role="poster" size="md" uppercase numberOfLines={1} style={styles.shrink}>
            {name}
          </Text>
          {tag ? (
            <View style={[styles.tag, { backgroundColor: `${theme.color.text.secondary}1F` }]}>
              {tag.icon ? (
                <FoundationIcon
                  name={tag.icon}
                  customSize={10}
                  color={theme.color.text.secondary}
                  decorative
                />
              ) : null}
              <Text role="eyebrow" size="2xs" color="secondary" uppercase>
                {tag.label}
              </Text>
            </View>
          ) : null}
        </View>
        <Text role="body" size="sm" color="secondary" numberOfLines={1}>
          {detail}
        </Text>
        {below ? (
          <Text role="control" size="xs" color={records ? 'accent' : 'muted'} numberOfLines={1}>
            {below}
          </Text>
        ) : null}
      </View>

      <View style={styles.day}>
        <Text role="eyebrow" size="xs" color="muted" uppercase>
          {weekday}
        </Text>
        <Text role="poster" size="xl">
          {day}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  panel: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  body: { flex: 1, gap: 3 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  day: { alignItems: 'center', minWidth: 36 },
})
