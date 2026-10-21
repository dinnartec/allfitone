/**
 * `INV-3` · Al terminar el registro, tu invitación — HU-SP-016.
 *
 * Shown once, right after onboarding, when an invitation to her verified address is
 * waiting. It accepts nothing: «Ver y decidir» opens INV-4, and «Ahora no» leaves it
 * waiting on «Hoy» until it expires. The coach and a programme are not offered here,
 * because the gym assigns them afterwards (HU-STUDIO-023).
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { shortDate } from '../../src/client/pro'
import type { PendingInvitation } from '../../src/client/gym-affiliation'
import { createSpaceInvitationFlow } from '../../src/client/gym-affiliation-transport'
import { GlyphRow, GymMark, RowCard } from '../../src/components/gym-ui'

export default function InvitationArrived() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const flow = useMemo(() => createSpaceInvitationFlow(), [])
  const [invitation, setInvitation] = useState<PendingInvitation | undefined>(undefined)

  useEffect(() => {
    let active = true
    flow
      .listMine()
      .then((pending) => {
        if (!active) return
        const found = pending.find((item) => item.id === id) ?? pending[0]
        if (found) setInvitation(found)
        else router.replace('/today')
      })
      .catch(() => {
        if (active) router.replace('/today')
      })
    return () => {
      active = false
    }
  }, [flow, id, router])

  if (!invitation) return <Screen edges={['top']}>{null}</Screen>
  const gym = invitation.organization_name

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.content}>
        <GymMark name={gym} size={64} />
        <Text role="control" size="2xl" align="center" accessibilityRole="header">
          {gym} te invitó
        </Text>
        <Text role="body" size="sm" color="secondary" align="center">
          La invitación llegó al correo con el que creaste tu cuenta.
        </Text>
        <View style={styles.rows}>
          <RowCard>
            {invitation.invited_by ? (
              <GlyphRow
                icon="person"
                title={`Te invita ${invitation.invited_by}`}
                caption={`Del equipo de ${gym}`}
              />
            ) : null}
            <GlyphRow
              icon="favourite"
              title="Allfit Pro incluido"
              caption={`Mientras sigas con ${gym}`}
              accent
            />
          </RowCard>
        </View>
        <View style={styles.note}>
          <FoundationIcon name="locked" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="xs" color="muted" style={styles.grow}>
            Todavía no aceptaste nada ni compartiste nada. Decides cada cosa por separado.
          </Text>
        </View>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Button
          label="Ver y decidir"
          onPress={() => router.replace({ pathname: '/invitation', params: { id: invitation.id } })}
        />
        <Button
          label="Ahora no, entrar a Allfit"
          variant="secondary"
          onPress={() => router.replace('/today')}
        />
        <Text role="body" size="xs" color="muted" align="center">
          Si entras sin decidir, la invitación te espera en Hoy hasta el{' '}
          {shortDate(invitation.expires_at)}.
        </Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 72, gap: 12 },
  rows: { alignSelf: 'stretch', marginTop: 12 },
  note: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  grow: { flex: 1 },
  footer: { paddingHorizontal: 24, paddingTop: 14, gap: 10 },
})
