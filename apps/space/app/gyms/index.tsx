/**
 * `PF-8` · Tus gimnasios — HU-SP-018, HU-SP-020.
 *
 * The covers waiting on her come first, because nobody else can answer them: while she
 * does not decide, the cover sees nothing (ADR-022). Then the gyms she trains at, with
 * the coach in charge, and the ones that ended, which no longer see anything new.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Monogram } from '@allfitone/react-native/monogram'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { coverSpan, endedSpan, pendingCovers } from '../../src/client/gym-affiliation'
import { gyms, type Cover, type MyRelationship } from '../../src/client/gym-affiliation-transport'
import { GymMark, RowCard } from '../../src/components/gym-ui'

interface PendingCover {
  readonly relationship: MyRelationship
  readonly cover: Cover
}

export default function Gyms() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [relationships, setRelationships] = useState<readonly MyRelationship[] | undefined>()
  const [covers, setCovers] = useState<readonly PendingCover[]>([])
  const [deciding, setDeciding] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    const page = await gyms.list()
    const active = page.data.filter((relationship) => relationship.status === 'active')
    const waiting = await Promise.all(
      active.map(async (relationship) =>
        pendingCovers((await gyms.covers(relationship.relationship_id)).data).map((cover) => ({
          relationship,
          cover,
        })),
      ),
    )
    setRelationships(page.data)
    setCovers(waiting.flat())
  }, [])

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setFailure('No pudimos cargar tus gimnasios. Revisa tu conexión.'))
    }, [load]),
  )

  const decide = async (pending: PendingCover, decision: 'accepted' | 'rejected') => {
    setDeciding(pending.cover.assignment_id)
    setFailure(undefined)
    try {
      await gyms.decideCover(
        pending.relationship.relationship_id,
        pending.cover.assignment_id,
        decision,
      )
      await load()
    } catch {
      setFailure('No pudimos guardar tu decisión. Inténtalo de nuevo.')
    } finally {
      setDeciding(undefined)
    }
  }

  const active = relationships?.filter((relationship) => relationship.status === 'active') ?? []
  const ended = relationships?.filter((relationship) => relationship.status !== 'active') ?? []

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tus gimnasios
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}

        {covers.map((pending) => (
          <View
            key={pending.cover.assignment_id}
            style={[
              styles.cover,
              {
                backgroundColor: theme.color.background.surface,
                borderColor: theme.color.status.warning,
              },
            ]}
          >
            <View style={styles.row}>
              <Monogram name={pending.cover.display_name} tone="warning" />
              <View style={styles.grow}>
                <Text role="control" size="sm">
                  {pending.cover.display_name} te cubriría
                </Text>
                <Text role="body" size="xs" style={{ color: theme.color.status.warning }}>
                  {pending.relationship.organization_name} · {coverSpan(pending.cover)}
                </Text>
              </View>
            </View>
            <Text role="body" size="xs" color="secondary">
              Mientras no decidas, no ve nada. Si aceptas, ve lo mismo que tu coach y solo en esas
              fechas.
            </Text>
            <View style={styles.answers}>
              <Button
                label="Rechazar"
                variant="secondary"
                disabled={deciding !== undefined}
                onPress={() => void decide(pending, 'rejected')}
                style={styles.grow}
              />
              <Button
                label="Aceptar"
                loading={deciding === pending.cover.assignment_id}
                disabled={deciding !== undefined}
                onPress={() => void decide(pending, 'accepted')}
                style={styles.grow}
              />
            </View>
          </View>
        ))}

        {relationships && relationships.length === 0 ? (
          <Text role="body" size="sm" color="secondary">
            Todavía no entrenas con ningún gimnasio.
          </Text>
        ) : null}

        {active.length > 0 ? (
          <Section title="Activos">
            {active.map((relationship) => (
              <GymRow
                key={relationship.relationship_id}
                relationship={relationship}
                caption={
                  relationship.holder_name
                    ? `Coach: ${relationship.holder_name}`
                    : 'Todavía sin coach asignado'
                }
                onPress={() =>
                  router.push({
                    pathname: '/gyms/[relationshipId]',
                    params: { relationshipId: relationship.relationship_id },
                  })
                }
                trailing={<Badge label="Activo" tone="success" variant="quiet" />}
              />
            ))}
          </Section>
        ) : null}

        {ended.length > 0 ? (
          <Section title="Terminados">
            {ended.map((relationship) => (
              <GymRow
                key={relationship.relationship_id}
                relationship={relationship}
                caption={endedSpan(relationship)}
                onPress={() =>
                  router.push({
                    pathname: '/gyms/[relationshipId]',
                    params: { relationshipId: relationship.relationship_id },
                  })
                }
                muted
              />
            ))}
          </Section>
        ) : null}

        <View style={styles.note}>
          <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="xs" color="muted" style={styles.grow}>
            Si un gimnasio te invita, la invitación te espera en Hoy. Aceptar no comparte nada por
            sí solo.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text role="control" size="sm" color="muted">
        {title}
      </Text>
      <RowCard>{children}</RowCard>
    </View>
  )
}

function GymRow({
  relationship,
  caption,
  onPress,
  trailing,
  muted,
}: {
  readonly relationship: MyRelationship
  readonly caption: string
  readonly onPress: () => void
  readonly trailing?: React.ReactNode
  readonly muted?: boolean
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.gymRow, pressed && styles.pressed]}
    >
      <View style={muted && styles.muted}>
        <GymMark name={relationship.organization_name} size={40} />
      </View>
      <View style={styles.grow}>
        <Text role="control" size="sm" color={muted ? 'secondary' : 'primary'}>
          {relationship.organization_name}
        </Text>
        <Text role="body" size="xs" color="muted">
          {caption}
        </Text>
      </View>
      {trailing ?? (
        <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 18,
  },
  content: { paddingHorizontal: 24, gap: 18 },
  cover: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gymRow: { paddingVertical: 12 },
  grow: { flex: 1 },
  answers: { flexDirection: 'row', gap: 10 },
  section: { gap: 8 },
  note: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  muted: { opacity: 0.45 },
  pressed: { opacity: 0.6 },
})
