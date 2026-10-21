/**
 * `INV-4` · Tu invitación — and `INV-7` when it is no longer there. HU-SP-016, HU-SP-017.
 *
 * Reached from the emailed link (by token) or from a pending invitation (by id). She
 * decides each thing on its own: the relationship here, each data category on «Decide
 * qué pueden ver» (N-8a). There is no «aceptar todo», and accepting the relationship
 * shares nothing by itself. Nothing leaves the phone until she confirms.
 *
 * An invitation that does not exist, expired, or was already answered reads the same:
 * no longer available (ADR-008).
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ApiError } from '../../src/client'
import {
  invitationExpiry,
  sharedSummary,
  type Decision,
  type InvitationKey,
} from '../../src/client/gym-affiliation'
import { createSpaceInvitationFlow } from '../../src/client/gym-affiliation-transport'
import {
  closeDraft,
  currentDraft,
  openDraft,
  takeLinkToken,
  type InvitationDraft,
} from '../../src/client/invitation-draft'
import { GlyphRow, GymMark, RowCard } from '../../src/components/gym-ui'

const CONFIRM_FAILED = 'No pudimos guardar tus decisiones. Revisa tu conexión e inténtalo de nuevo.'
const ANSWER: readonly { readonly value: Decision; readonly label: string }[] = [
  { value: 'rejected', label: 'No' },
  { value: 'accepted', label: 'Sí' },
]

export default function InvitationScreen() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const flow = useMemo(() => createSpaceInvitationFlow(), [])
  const [draft, setDraft] = useState<InvitationDraft | undefined>(undefined)
  const [gone, setGone] = useState(false)
  const [, redraw] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useFocusEffect(
    useCallback(() => {
      // Coming back from N-8a: the draft already holds what she chose there.
      const held = currentDraft()
      if (held) {
        setDraft(held)
        redraw((tick) => tick + 1)
        return
      }
      const token = takeLinkToken()
      const key: InvitationKey | undefined = token
        ? { token }
        : id
          ? { invitationId: id }
          : undefined
      if (!key) {
        setGone(true)
        return
      }
      let active = true
      flow
        .read(key)
        .then((invitation) => {
          if (!active) return
          if (invitation.status !== 'pending') {
            setGone(true)
            return
          }
          setDraft(openDraft(key, invitation))
        })
        .catch((cause: unknown) => {
          if (!active) return
          const missing =
            cause instanceof ApiError &&
            (cause.failure === 'not-found' || cause.failure === 'forbidden')
          if (missing) setGone(true)
          else setFailure('No pudimos abrir la invitación. Revisa tu conexión.')
        })
      return () => {
        active = false
      }
    }, [flow, id]),
  )

  const leave = () => {
    closeDraft()
    router.replace('/today')
  }

  if (gone) return <Unavailable onLeave={leave} />

  const invitation = draft?.invitation
  const asked = invitation?.scope_options.length ?? 0

  const confirm = async () => {
    if (!draft || !invitation) return
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await flow.decide({
        invitation: draft.key,
        intentId: invitation.invitation_intent_id,
        relationship: draft.relationship,
        scopes: draft.relationship === 'accepted' ? draft.scopes : {},
      })
      closeDraft()
      if (result.relationship_id) {
        router.replace({
          pathname: '/invitation/done',
          params: {
            gym: invitation.organization.display_name,
            shared: String(result.granted_scope_codes.length),
            asked: String(asked),
          },
        })
      } else {
        router.replace('/today')
      }
    } catch {
      setFailure(CONFIRM_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Cerrar" onPress={leave} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tu invitación
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}
        {draft && invitation ? (
          <>
            <View style={styles.gym}>
              <GymMark name={invitation.organization.display_name} />
              <View style={styles.grow}>
                <Text role="control" size="lg">
                  {invitation.organization.display_name}
                </Text>
                <Text role="body" size="xs" color="muted">
                  {[
                    invitation.invited_by ? `Te invita ${invitation.invited_by}` : null,
                    invitationExpiry(invitation.expires_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
            <Text role="body" size="sm" color="secondary">
              Decide cada cosa. No hay un «aceptar todo».
            </Text>

            <View style={styles.section}>
              <Text role="control" size="sm" color="muted">
                La relación
              </Text>
              <RowCard>
                <View style={styles.block}>
                  <GlyphRow
                    icon="organization"
                    title={`Entrenar con ${invitation.organization.display_name}`}
                    accent
                  >
                    <SegmentedControl
                      items={ANSWER}
                      value={draft.relationship}
                      accessibilityLabel="Entrenar con este gimnasio"
                      onChange={(value) => {
                        draft.relationship = value
                        redraw((tick) => tick + 1)
                      }}
                      style={styles.answer}
                    />
                  </GlyphRow>
                  <Text role="body" size="xs" color="muted" style={styles.note}>
                    Incluye Allfit Pro mientras sigas con ellos. Aceptar no comparte ningún dato por
                    sí solo.
                  </Text>
                </View>
              </RowCard>
            </View>

            <View style={styles.section}>
              <Text role="control" size="sm" color="muted">
                Lo que pueden ver
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={draft.relationship === 'rejected' || asked === 0}
                onPress={() => router.push('/invitation/share')}
                style={({ pressed }) => [
                  draft.relationship === 'rejected' && styles.dimmed,
                  pressed && styles.pressed,
                ]}
              >
                <RowCard>
                  <GlyphRow
                    icon="permissions"
                    title="Elegir qué compartes"
                    caption={
                      draft.relationship === 'rejected'
                        ? 'Sin relación no se comparte nada'
                        : sharedSummary(draft.scopes, asked)
                    }
                  >
                    <FoundationIcon
                      name="next"
                      size="sm"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                  </GlyphRow>
                </RowCard>
              </Pressable>
            </View>
          </>
        ) : !failure ? (
          <Text role="body" size="sm" color="muted">
            Abriendo tu invitación…
          </Text>
        ) : null}
      </ScrollView>

      {draft ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + 14, backgroundColor: theme.color.background.canvas },
          ]}
        >
          <Button label="Confirmar mis decisiones" loading={busy} onPress={() => void confirm()} />
          <Text role="body" size="xs" color="muted" align="center">
            Nada se comparte hasta que confirmes.
          </Text>
        </View>
      ) : null}
    </Screen>
  )
}

/** `INV-7`: the same answer for an invitation that never was, expired or was used. */
function Unavailable({ onLeave }: { readonly onLeave: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Cerrar" onPress={onLeave} />
        <Text role="control" size="xl" accessibilityRole="header">
          Invitación
        </Text>
      </View>
      <View style={styles.gone}>
        <View style={[styles.goneGlyph, { backgroundColor: theme.color.background.surface }]}>
          <FoundationIcon name="external" size="lg" color={theme.color.icon.secondary} decorative />
        </View>
        <Text role="control" size="xl" align="center">
          Esta invitación ya no está disponible
        </Text>
        <Text role="body" size="sm" color="secondary" align="center">
          Puede que haya vencido o que ya se haya usado. Pídele a tu gimnasio que te envíe una
          nueva.
        </Text>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Button label="Entrar a Allfit" variant="secondary" onPress={onLeave} />
      </View>
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
  gym: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 2 },
  section: { gap: 8 },
  block: { paddingBottom: 12 },
  answer: { width: 112 },
  note: { paddingRight: 4 },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    gap: 10,
  },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  goneGlyph: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
})
