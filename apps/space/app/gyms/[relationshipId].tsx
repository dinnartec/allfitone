/**
 * `PF-9` · Historia de una relación — HU-SP-019, HU-SP-095.
 *
 * What happened between her and the gym, newest first, as she would say it. The record
 * is append-only, and a reason the gym declares on ending it is never shown here.
 *
 * Ending it is hers to do (OP-REL-007). It freezes what the gym could see up to today and
 * stops anything new reaching them, so it asks first in a sheet.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { historyLine } from '../../src/client/gym-affiliation'
import {
  gyms,
  type HistoryPage,
  type MyRelationship,
} from '../../src/client/gym-affiliation-transport'
import { shortDate } from '../../src/client/pro'
import { GlyphRow, GymMark, RowCard } from '../../src/components/gym-ui'
import type { IconName } from '@allfitone/icons'

const EVENT_ICON: Record<string, IconName> = {
  relationship_started: 'check',
  holder_assigned: 'person',
  holder_ended: 'person',
  substitution_proposed: 'people',
  substitution_accepted: 'people',
  substitution_ended: 'people',
  consent_decided: 'permissions',
  relationship_ended: 'close',
}

export default function RelationshipHistory() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { relationshipId } = useLocalSearchParams<{ relationshipId: string }>()
  const [relationship, setRelationship] = useState<MyRelationship | undefined>()
  const [events, setEvents] = useState<HistoryPage['data']>([])
  const [asking, setAsking] = useState(false)
  const [ending, setEnding] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    const [page, history] = await Promise.all([gyms.list(), gyms.history(relationshipId)])
    setRelationship(page.data.find((item) => item.relationship_id === relationshipId))
    setEvents(history.data)
  }, [relationshipId])

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setFailure('No pudimos cargar esta relación. Revisa tu conexión.'))
    }, [load]),
  )

  const end = async () => {
    setEnding(true)
    setFailure(undefined)
    try {
      await gyms.end(relationshipId)
      setAsking(false)
      await load()
    } catch {
      setAsking(false)
      setFailure('No pudimos terminar la relación. Inténtalo de nuevo.')
    } finally {
      setEnding(false)
    }
  }

  const name = relationship?.organization_name ?? ''
  const active = relationship?.status === 'active'

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header" numberOfLines={1}>
          {name}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}
        {relationship ? (
          <View style={styles.summary}>
            <GymMark name={name} />
            <View style={styles.grow}>
              <Text role="control" size="lg">
                {active
                  ? `Activa desde el ${shortDate(relationship.started_at)}`
                  : `Terminó el ${shortDate(relationship.ended_at ?? relationship.started_at)}`}
              </Text>
              <Text role="body" size="xs" color="muted">
                {active
                  ? relationship.holder_name
                    ? `Tu coach: ${relationship.holder_name}`
                    : 'Todavía sin coach asignado'
                  : 'Ya no ven nada nuevo'}
              </Text>
            </View>
          </View>
        ) : null}

        {events.length > 0 ? (
          <View style={styles.section}>
            <Text role="control" size="sm" color="muted">
              Lo que ha pasado
            </Text>
            <RowCard>
              {events.map((event, index) => (
                <GlyphRow
                  key={`${event.type}-${event.source_id}-${String(index)}`}
                  icon={EVENT_ICON[event.type] ?? 'history'}
                  title={historyLine(event)}
                  caption={shortDate(event.occurred_at)}
                />
              ))}
            </RowCard>
          </View>
        ) : null}

        <View style={styles.note}>
          <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="xs" color="muted" style={styles.grow}>
            Este registro no se edita ni se borra. Si el gimnasio declara un motivo al terminar, no
            lo ves, igual que ellos no ven el tuyo.
          </Text>
        </View>
      </ScrollView>

      {active ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + 14, backgroundColor: theme.color.background.canvas },
          ]}
        >
          <Button label="Terminar la relación" variant="danger" onPress={() => setAsking(true)} />
        </View>
      ) : null}

      <Sheet visible={asking} onDismiss={() => setAsking(false)} title={`¿Terminar con ${name}?`}>
        <View style={styles.sheet}>
          <Text role="body" size="sm" color="secondary">
            Desde hoy no reciben nada nuevo de ti. Lo que ya compartiste hasta hoy queda congelado,
            y tu historial sigue siendo tuyo.
          </Text>
          <Button
            label="Terminar la relación"
            variant="danger"
            loading={ending}
            onPress={() => void end()}
          />
          <Button label="Seguir con ellos" variant="secondary" onPress={() => setAsking(false)} />
        </View>
      </Sheet>
    </Screen>
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
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  section: { gap: 8 },
  note: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
  },
  sheet: { gap: 12 },
})
