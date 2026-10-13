/**
 * `PRO-7` · Tus pagos — what the person has paid for Pro, the latest first.
 *
 * Each charge is what a store reported. Allfit never holds the card, so receipts and the
 * payment method stay where the person paid: their Apple or Google Play account.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { money, shortDate, storeName, type ProFlow, type ProPayments } from '../../src/client/pro'
import { createSpaceProFlow } from '../../src/client/pro-transport'

const UNAVAILABLE = 'No pudimos cargar tus pagos. Revisa tu conexión e inténtalo de nuevo.'

export default function ProPaymentsRoute() {
  const flow = useMemo(() => createSpaceProFlow(), [])
  return <ProPaymentsScreen flow={flow} />
}

/** The screen itself, given its flow: the route passes the real one. */
export function ProPaymentsScreen({ flow }: { readonly flow: ProFlow }) {
  const router = useRouter()
  const theme = useTheme()
  const [payments, setPayments] = useState<ProPayments | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useFocusEffect(
    useCallback(() => {
      let active = true
      flow
        .payments()
        .then((read) => active && setPayments(read))
        .catch(() => active && setFailure(UNAVAILABLE))
      return () => {
        active = false
      }
    }, [flow]),
  )

  const list = payments?.payments ?? []
  const card = {
    backgroundColor: theme.color.background.surface,
    borderColor: theme.color.border.subtle,
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tus pagos
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <InlineAlert message={failure} /> : null}

        {payments && list.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            Todavía no hay cobros de Allfit Pro.
          </Text>
        ) : null}

        {list.length > 0 ? (
          <View style={[styles.card, card]}>
            {list.map((payment, index) => {
              const paid = payment.result === 'succeeded'
              return (
                <View
                  key={payment.id}
                  style={[
                    styles.row,
                    index > 0 && { borderTopWidth: 1, borderTopColor: theme.color.border.subtle },
                  ]}
                >
                  <FoundationIcon
                    name={paid ? 'check' : 'close'}
                    size="sm"
                    color={paid ? theme.color.icon.accent : theme.color.icon.secondary}
                    decorative
                  />
                  <View style={styles.grow}>
                    <Text role="control" size="sm">
                      {paid ? 'Pagado' : 'Cobro fallido'}
                    </Text>
                    <Text role="body" size="xs" color="muted">
                      {shortDate(payment.occurred_at)} · {storeName(payment.store)}
                    </Text>
                  </View>
                  <Text role="control" size="sm" color={paid ? 'primary' : 'muted'}>
                    {money(payment.amount_minor, payment.currency_code) ?? '—'}
                  </Text>
                </View>
              )
            })}
          </View>
        ) : null}

        <View style={styles.note}>
          <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="xs" color="muted" style={styles.grow}>
            Tus recibos y tu forma de pago están en tu cuenta de Apple o de Google Play. Allfit no
            tiene tu tarjeta.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  card: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  grow: { flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})
