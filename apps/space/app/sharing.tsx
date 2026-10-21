/**
 * `N-8b` · Lo que compartes, and `N-8c` · taking one category back — HU-SP-030, HU-SP-031.
 *
 * Everything she shares, one gym at a time, each category with how it stands. The gyms
 * she trains at come first; nutrition sits on its own card, as the designs draw it. A
 * gym she no longer trains with still shows what it kept, and that can be taken back
 * too (ADR-023).
 *
 * «Quitar» asks first: it cuts that category alone, deletes nothing of hers, and cannot
 * be undone — sharing again takes a new permission.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import type { IconName } from '@allfitone/icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { scopeTitle } from '../src/client/gym-affiliation'
import {
  canRevoke,
  consentLine,
  groupCaption,
  groupConsents,
  revokeCopy,
  type Consent,
  type SharingGroup,
} from '../src/client/sharing'
import { consents } from '../src/client/sharing-transport'
import { GlyphRow, GymMark, RowCard, scopeIcon } from '../src/components/gym-ui'

const SHEET_ICONS: readonly IconName[] = ['locked', 'permissions', 'history', 'info']

export default function Sharing() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [groups, setGroups] = useState<readonly SharingGroup[] | undefined>(undefined)
  const [asking, setAsking] = useState<Consent | undefined>(undefined)
  const [revoking, setRevoking] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    setGroups(groupConsents(await consents.list()))
  }, [])

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setFailure('No pudimos cargar lo que compartes. Revisa tu conexión.'))
    }, [load]),
  )

  const revoke = async (consent: Consent) => {
    if (!consent.grant_id) return
    setRevoking(true)
    setFailure(undefined)
    try {
      await consents.revoke(consent.grant_id)
      setAsking(undefined)
      await load()
    } catch {
      setAsking(undefined)
      setFailure('No pudimos dejar de compartirlo. Inténtalo de nuevo.')
    } finally {
      setRevoking(false)
    }
  }

  const active = groups?.filter((group) => group.status === 'active') ?? []
  const ended = groups?.filter((group) => group.status !== 'active') ?? []
  const copy = asking ? revokeCopy(asking) : undefined

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Lo que compartes
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}

        {groups && groups.length === 0 ? (
          <Text role="body" size="sm" color="secondary">
            No compartes nada con ningún gimnasio. Cuando uno te invite, decides aquí qué ve.
          </Text>
        ) : null}

        {active.map((group) => (
          <Gym key={group.relationshipId} group={group} onRevoke={setAsking} />
        ))}

        {ended.map((group) => (
          <Gym key={group.relationshipId} group={group} onRevoke={setAsking} ended />
        ))}

        {ended.length > 0 ? (
          <View style={styles.note}>
            <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
            <Text role="body" size="xs" color="muted" style={styles.grow}>
              Aunque terminaste, aún pueden ver lo que les compartiste hasta esa fecha. Quítalo si
              no quieres que lo sigan viendo.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={asking !== undefined}
        onDismiss={() => setAsking(undefined)}
        title={copy?.title ?? ''}
      >
        <View style={styles.sheet}>
          {copy?.lines.map((line, index) => (
            <View key={line} style={styles.sheetLine}>
              <FoundationIcon
                name={SHEET_ICONS[index] ?? 'info'}
                size="sm"
                color={index === 0 ? theme.color.status.danger : theme.color.icon.secondary}
                decorative
              />
              <Text role="body" size="sm" color="secondary" style={styles.grow}>
                {line}
              </Text>
            </View>
          ))}
          <Button
            label="Dejar de compartir"
            variant="danger"
            loading={revoking}
            onPress={() => {
              if (asking) void revoke(asking)
            }}
          />
          <Button
            label="Seguir compartiendo"
            variant="secondary"
            onPress={() => setAsking(undefined)}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

function Gym({
  group,
  onRevoke,
  ended,
}: {
  readonly group: SharingGroup
  readonly onRevoke: (consent: Consent) => void
  readonly ended?: boolean
}) {
  return (
    <View style={styles.gym}>
      <View style={[styles.gymHead, ended && styles.muted]}>
        <GymMark name={group.organizationName} size={40} />
        <View style={styles.grow}>
          <Text role="control" size="sm">
            {group.organizationName}
          </Text>
          <Text role="body" size="xs" color="muted">
            {groupCaption(group)}
          </Text>
        </View>
      </View>
      {group.training.length > 0 ? (
        <RowCard>
          {group.training.map((consent) => (
            <Category key={consent.scope_code} consent={consent} onRevoke={onRevoke} />
          ))}
        </RowCard>
      ) : null}
      {group.nutrition.length > 0 ? (
        <>
          <Text role="control" size="xs" color="muted" style={styles.label}>
            Alimentación · {group.organizationName}
          </Text>
          <RowCard>
            {group.nutrition.map((consent) => (
              <Category key={consent.scope_code} consent={consent} onRevoke={onRevoke} />
            ))}
          </RowCard>
        </>
      ) : null}
    </View>
  )
}

function Category({
  consent,
  onRevoke,
}: {
  readonly consent: Consent
  readonly onRevoke: (consent: Consent) => void
}) {
  const theme = useTheme()
  const title = scopeTitle(consent)
  return (
    <GlyphRow icon={scopeIcon(consent.scope_code)} title={title} caption={consentLine(consent)}>
      {canRevoke(consent) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dejar de compartir ${title}`}
          hitSlop={8}
          onPress={() => onRevoke(consent)}
          style={({ pressed }) => [
            styles.remove,
            { borderColor: theme.color.status.danger },
            pressed && styles.pressed,
          ]}
        >
          <Text role="control" size="xs" style={{ color: theme.color.status.danger }}>
            Quitar
          </Text>
        </Pressable>
      ) : (
        <Text role="body" size="xs" color="muted">
          No compartes
        </Text>
      )}
    </GlyphRow>
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
  content: { paddingHorizontal: 24, gap: 22 },
  gym: { gap: 10 },
  gymHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { marginTop: 4 },
  grow: { flex: 1 },
  muted: { opacity: 0.6 },
  remove: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pressed: { opacity: 0.6 },
  note: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  sheet: { gap: 14 },
  sheetLine: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
})
