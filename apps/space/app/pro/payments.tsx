/**
 * `PRO-D` · Tus pagos — what the person has paid for Pro, the latest first.
 *
 * The total paid leads, in the same numerals as every other figure in the app; each
 * charge follows with its result. Allfit never holds the card, so receipts and the
 * payment method stay where the person paid: their Apple or Google Play account.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import type { IconName } from '@allfitone/icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  money,
  renewalLine,
  shortDate,
  storeName,
  subscriptionOf,
  type ProFlow,
  type ProPayments,
  type ProStatus,
} from '../../src/client/pro'
import { createSpaceProFlow } from '../../src/client/pro-transport'
import { Note, SectionLabel } from '../../src/components/pro-ui'

const UNAVAILABLE = 'No pudimos cargar tus pagos. Revisa tu conexión e inténtalo de nuevo.'

export default function ProPaymentsRoute() {
  const flow = useMemo(() => createSpaceProFlow(), [])
  return <ProPaymentsScreen flow={flow} />
}

/** The screen itself, given its flow: the route passes the real one. */
export function ProPaymentsScreen({ flow }: { readonly flow: ProFlow }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  const [payments, setPayments] = useState<ProPayments | undefined>(undefined)
  const [status, setStatus] = useState<ProStatus | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useFocusEffect(
    useCallback(() => {
      let active = true
      Promise.all([flow.payments(), flow.read()])
        .then(([paid, read]) => {
          if (!active) return
          setPayments(paid)
          setStatus(read)
        })
        .catch(() => active && setFailure(UNAVAILABLE))
      return () => {
        active = false
      }
    }, [flow]),
  )

  const list = payments?.payments ?? []
  const succeeded = list.filter((payment) => payment.result === 'succeeded')
  const [latest] = succeeded
  const first = succeeded[succeeded.length - 1]
  const sameCurrency = succeeded.every((payment) => payment.currency_code === latest?.currency_code)
  const total = sameCurrency
    ? succeeded.reduce((sum, payment) => sum + (payment.amount_minor ?? 0), 0)
    : null
  const subscription = status ? subscriptionOf(status) : undefined
  const store = subscription?.store ?? latest?.store

  const chips: (readonly [IconName, string])[] = []
  if (store) chips.push(['external', `Con ${storeName(store)}`])
  if (subscription) chips.push(['frequency', renewalLine(subscription)])

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tus pagos
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}

        {payments && list.length === 0 ? (
          <Note icon="history">Todavía no hay cobros de Allfit Pro.</Note>
        ) : null}

        {latest && total !== null ? (
          <View style={styles.summary}>
            <SectionLabel>Pagado a Allfit</SectionLabel>
            <View style={styles.totalRow}>
              <Text role="data" size="6xl">
                {money(total, latest.currency_code) ?? '—'}
              </Text>
              {first ? (
                <Text role="body" size="sm" color="secondary">
                  desde el {shortDate(first.occurred_at)}
                </Text>
              ) : null}
            </View>
            <View style={styles.chips}>
              {chips.map(([icon, text]) => (
                <View
                  key={text}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: theme.color.background.surface,
                      borderColor: theme.color.border.subtle,
                    },
                  ]}
                >
                  <FoundationIcon
                    name={icon}
                    size="xs"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                  <Text role="control" size="xs" color="secondary">
                    {text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {list.length > 0 ? (
          <View style={styles.section}>
            <SectionLabel>Cobros</SectionLabel>
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: theme.color.background.surface,
                  borderColor: theme.color.border.subtle,
                },
              ]}
            >
              {list.map((payment, index) => {
                const paid = payment.result === 'succeeded'
                const tint = paid ? theme.color.status.success : theme.color.status.danger
                return (
                  <View
                    key={payment.id}
                    style={[
                      styles.row,
                      index > 0 && { borderTopWidth: 1, borderTopColor: theme.color.border.subtle },
                    ]}
                  >
                    <View style={[styles.badge, { backgroundColor: `${tint}1F` }]}>
                      <FoundationIcon
                        name={paid ? 'check' : 'close'}
                        size="sm"
                        color={tint}
                        decorative
                      />
                    </View>
                    <View style={styles.grow}>
                      <Text role="control" size="sm">
                        {shortDate(payment.occurred_at)}
                      </Text>
                      <Text role="body" size="xs" color={paid ? 'muted' : 'danger'}>
                        {paid ? 'Pagado' : `${storeName(payment.store)} no pudo cobrar`}
                      </Text>
                    </View>
                    <Text role="data" size="lg" color={paid ? 'primary' : 'muted'}>
                      {money(payment.amount_minor, payment.currency_code) ?? '—'}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>
        ) : null}

        <Note icon="locked">
          Tus recibos y tu tarjeta están en tu cuenta de {store ? storeName(store) : 'la tienda'}.
          Allfit nunca ve tu tarjeta.
        </Note>
      </ScrollView>
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
  content: { paddingHorizontal: 24, gap: 26 },
  summary: { gap: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  section: { gap: 10 },
  panel: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, gap: 2 },
})
