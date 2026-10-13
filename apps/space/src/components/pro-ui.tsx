/**
 * The pieces the Pro screens share (`PRO-A1..A3`, `PRO-B`, `PRO-C`, `PRO-D`).
 *
 * The membership card is the screen's subject, not a box among boxes: a dark petrol
 * gradient, the accent's glow in one corner and «PRO» as a watermark, so a person sees
 * at a glance what plan they are on. The free plan draws the same card without accent,
 * on purpose: it is a plan, not a lack of one.
 *
 * Everything else stays quiet — one panel for the ways out, rows divided by a hairline,
 * and notes with an icon instead of more cards — so the card keeps being the subject.
 */

import type { IconName } from '@allfitone/icons'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { featureIcon, featureSentence, type ProFeature } from '../client/pro'

const PRO_CARD = ['#0E3B45', '#08141C', '#050A10'] as const
const FREE_CARD = ['#13222B', '#0A131A'] as const
const GLOW = ['#55EFFB38', '#55EFFB00'] as const
// The accent at 6%: a texture, never a word competing with the plan's own name.
const WATERMARK = '#55EFFB0F'

/** A section's name, in sentence case like every other text in Space. */
export function SectionLabel({ children }: { readonly children: string }) {
  return (
    <Text role="control" size="sm" color="muted">
      {children}
    </Text>
  )
}

export interface CardFact {
  readonly label: string
  readonly value: string
}

/** The membership card: «PRO» with its source, or the free plan, with up to two facts. */
export function MembershipCard({
  pro,
  source,
  facts,
}: {
  readonly pro: boolean
  readonly source: string
  readonly facts: readonly CardFact[]
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.card,
        { borderColor: pro ? theme.color.accent.tonalBorder : theme.color.border.subtle },
        pro ? styles.cardPro : styles.cardFree,
      ]}
    >
      <LinearGradient
        colors={pro ? PRO_CARD : FREE_CARD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {pro ? (
        <>
          <LinearGradient
            colors={GLOW}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.35, y: 0.75 }}
            style={StyleSheet.absoluteFill}
          />
          <Text role="display" size="9xl" style={[styles.watermark, { color: WATERMARK }]}>
            PRO
          </Text>
        </>
      ) : null}

      <View style={styles.cardTop}>
        <View style={styles.seal}>
          <FoundationIcon
            name={pro ? 'favourite' : 'person'}
            size="sm"
            color={pro ? theme.color.icon.accent : theme.color.icon.secondary}
            decorative
          />
          <Text role="control" size="xs" color={pro ? 'accent' : 'muted'}>
            {pro ? 'Allfit Pro' : 'Tu plan'}
          </Text>
        </View>
        {pro ? (
          <View
            style={[
              styles.live,
              {
                borderColor: theme.color.status.success,
                backgroundColor: theme.color.accent.tonal,
              },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: theme.color.status.success }]} />
            <Text role="control" size="xs" color="success">
              Activo
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardMiddle}>
        <Text role="display" size="6xl" accessibilityRole="header">
          {pro ? 'PRO' : 'GRATIS'}
        </Text>
        <Text role="body" size="sm" color="secondary">
          {source}
        </Text>
      </View>

      {facts.length > 0 ? (
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View key={fact.label} style={styles.fact}>
              <Text role="body" size="xs" color="muted">
                {fact.label}
              </Text>
              <Text role="data" size="xl">
                {fact.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** Each function as a sentence; Pro's marked in accent, a function left out quieter. */
export function FeatureList({
  features,
  pro,
  waiting,
}: {
  readonly features: readonly ProFeature[]
  readonly pro: boolean
  readonly waiting: string
}) {
  const theme = useTheme()
  if (features.length === 0) {
    return (
      <Note icon="explore" accent>
        {waiting}
      </Note>
    )
  }
  return (
    <View>
      {features.map((feature, index) => (
        <View
          key={feature.code}
          style={[
            styles.feature,
            index > 0 && { borderTopWidth: 1, borderTopColor: theme.color.border.subtle },
          ]}
        >
          <FoundationIcon
            name={featureIcon(feature.code)}
            size="sm"
            color={pro ? theme.color.icon.accent : theme.color.icon.secondary}
            decorative
          />
          <Text
            role="body"
            size="sm"
            color={feature.enabled ? 'primary' : 'secondary'}
            style={styles.grow}
          >
            {featureSentence(feature)}
          </Text>
        </View>
      ))}
    </View>
  )
}

export interface PanelLink {
  readonly icon: IconName
  readonly title: string
  readonly caption: string
  readonly onPress: () => void
}

/** The ways out of a screen, in one panel divided by hairlines. */
export function LinkPanel({ links }: { readonly links: readonly PanelLink[] }) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      {links.map((link, index) => (
        <Pressable
          key={link.title}
          accessibilityRole="button"
          accessibilityLabel={`${link.title}. ${link.caption}`}
          onPress={link.onPress}
          style={({ pressed }) => [
            styles.link,
            index > 0 && { borderTopWidth: 1, borderTopColor: theme.color.border.subtle },
            pressed && styles.pressed,
          ]}
        >
          <FoundationIcon
            name={link.icon}
            size="md"
            color={theme.color.icon.secondary}
            decorative
          />
          <View style={styles.grow}>
            <Text role="control" size="sm">
              {link.title}
            </Text>
            <Text role="body" size="xs" color="muted">
              {link.caption}
            </Text>
          </View>
          <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
        </Pressable>
      ))}
    </View>
  )
}

/** A line with an icon: what a card would say, without the card. */
export function Note({
  icon,
  accent,
  children,
}: {
  readonly icon: IconName
  readonly accent?: boolean
  readonly children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={styles.note}>
      <View
        style={[
          styles.noteGlyph,
          accent
            ? {
                backgroundColor: theme.color.accent.tonal,
                borderColor: theme.color.accent.tonalBorder,
              }
            : styles.noteGlyphPlain,
        ]}
      >
        <FoundationIcon
          name={icon}
          size="sm"
          color={accent ? theme.color.icon.accent : theme.color.icon.secondary}
          decorative
        />
      </View>
      <Text role="body" size="sm" color="secondary" style={styles.grow}>
        {children}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 22,
    gap: 16,
  },
  cardPro: { minHeight: 214 },
  cardFree: { minHeight: 168 },
  watermark: { position: 'absolute', right: -22, bottom: -46 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seal: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cardMiddle: { gap: 4 },
  facts: { flexDirection: 'row', gap: 26 },
  fact: { gap: 3 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  grow: { flex: 1 },
  panel: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 18 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  pressed: { opacity: 0.6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteGlyph: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteGlyphPlain: { width: 20, height: 20, borderWidth: 0 },
})
