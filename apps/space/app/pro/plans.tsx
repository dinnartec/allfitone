/**
 * `PRO-2` · Gratis y Pro — `HU-SP-084`, `HU-SP-085`.
 *
 * What each plan includes, side by side, and the one way to pay inside the app: the
 * phone's own store. The price shown is the store's, localized for the person; it is the
 * one they are charged and the one that stays frozen while they remain subscribed.
 *
 * Whoever already has Pro through a gym is told so before the store's sheet opens: paying
 * would only stop them depending on that gym (`HU-SP-085` criterion 6).
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import {
  freePlanOf,
  gymWarning,
  limitLabel,
  productFor,
  proPlanOf,
  storeName,
  subscriptionOf,
  WAITING_FOR_FEATURES,
  type ProFlow,
  type ProPlanCatalogue,
  type ProStatus,
} from '../../src/client/pro'
import { deviceStore, loadOffer, type StoreOffer } from '../../src/client/pro-store'
import { createSpaceProFlow } from '../../src/client/pro-transport'
import { useProPurchase } from '../../src/components/use-pro-purchase'

const UNAVAILABLE = 'No pudimos cargar los planes. Revisa tu conexión e inténtalo de nuevo.'
const NOT_ON_SALE = 'Pro todavía no está a la venta en esta tienda.'
const PERIOD: Record<string, string> = { month: 'al mes', year: 'al año' }

export default function ProPlansRoute() {
  const flow = useMemo(() => createSpaceProFlow(), [])
  return <ProPlans flow={flow} offerFor={loadOffer} />
}

/** The screen itself, given its flow and how the store describes a product. */
export function ProPlans({
  flow,
  offerFor,
}: {
  readonly flow: ProFlow
  readonly offerFor: (productId: string) => Promise<StoreOffer | undefined>
}) {
  const router = useRouter()
  const theme = useTheme()
  const [status, setStatus] = useState<ProStatus | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ProPlanCatalogue | undefined>(undefined)
  const [offer, setOffer] = useState<StoreOffer | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const purchase = useProPurchase(flow, () => router.replace('/pro'))

  useFocusEffect(
    useCallback(() => {
      let active = true
      Promise.all([flow.read(), flow.plans()])
        .then(async ([read, plans]) => {
          if (!active) return
          setStatus(read)
          setCatalogue(plans)
          const pro = proPlanOf(plans)
          const product = pro ? productFor(pro, deviceStore) : undefined
          const found = product ? await offerFor(product).catch(() => undefined) : undefined
          if (!active) return
          setOffer(found)
          setFailure(found ? undefined : NOT_ON_SALE)
        })
        .catch(() => active && setFailure(UNAVAILABLE))
      return () => {
        active = false
      }
    }, [flow, offerFor]),
  )

  const pro = catalogue ? proPlanOf(catalogue) : undefined
  const free = catalogue ? freePlanOf(catalogue) : undefined
  const paying = status ? subscriptionOf(status) : undefined
  const warning = status ? gymWarning(status) : undefined
  const card = {
    backgroundColor: theme.color.background.surface,
    borderColor: theme.color.border.subtle,
  }
  const features = pro?.features ?? []

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Cerrar" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Allfit Pro
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text role="display" size="xl">
            Todo Allfit, sin depender de un gimnasio
          </Text>
          <Text role="body" size="sm" color="secondary">
            Más profundidad y volumen. Tus datos, siempre tuyos.
          </Text>
        </View>

        {failure ? (
          <InlineAlert message={failure} tone={failure === NOT_ON_SALE ? 'info' : 'danger'} />
        ) : null}
        {purchase.failure ? <InlineAlert message={purchase.failure} /> : null}

        {offer && pro ? (
          <View style={[styles.card, card]}>
            <View style={styles.price}>
              <Text role="display" size="2xl">
                {offer.displayPrice}
              </Text>
              <Text role="body" size="sm" color="muted">
                {pro.billing_period ? PERIOD[pro.billing_period] : ''}
              </Text>
            </View>
            <Text role="body" size="sm" color="accent">
              El precio que aceptas queda congelado mientras sigas suscrito.
            </Text>
          </View>
        ) : null}

        <View style={[styles.card, card]}>
          <View style={styles.compareHead}>
            <Text role="eyebrow" size="2xs" color="muted" style={styles.grow}>
              QUÉ INCLUYE
            </Text>
            <Text role="eyebrow" size="2xs" color="muted" style={styles.column}>
              {free?.name.toUpperCase() ?? 'GRATIS'}
            </Text>
            <Text role="eyebrow" size="2xs" color="accent" style={styles.column}>
              PRO
            </Text>
          </View>
          {features.length === 0 ? (
            <Text role="body" size="sm" color="muted">
              {WAITING_FOR_FEATURES}
            </Text>
          ) : (
            features.map((feature) => {
              const onFree = free?.features.find((candidate) => candidate.code === feature.code)
              return (
                <View key={feature.code} style={styles.compareRow}>
                  <Text role="body" size="sm" style={styles.grow}>
                    {feature.name}
                  </Text>
                  <Text role="body" size="sm" color="muted" style={styles.column}>
                    {onFree ? limitLabel(onFree) : 'No incluido'}
                  </Text>
                  <Text role="control" size="sm" style={styles.column}>
                    {limitLabel(feature)}
                  </Text>
                </View>
              )
            })
          )}
        </View>

        <View style={[styles.card, card]}>
          <View style={styles.note}>
            <FoundationIcon name="check" size="sm" color={theme.color.icon.accent} decorative />
            <Text role="control" size="sm" color="accent">
              Siempre gratis, en los dos planes
            </Text>
          </View>
          <Text role="body" size="sm" color="secondary">
            Decidir qué compartes, ver quién vio tus datos, descargarlos y pedir que se borren.
          </Text>
        </View>

        {warning ? <InlineAlert message={warning} tone="info" /> : null}

        {paying ? (
          <InlineAlert message="Ya pagas Pro. Lo administras desde «Tu plan»." tone="info" />
        ) : (
          <Button
            label={`Suscribirme con ${storeName(deviceStore)}`}
            loading={purchase.busy}
            disabled={!offer || !status}
            onPress={() => {
              if (offer && status) void purchase.subscribe(offer, status.account_token)
            }}
          />
        )}
        <Button
          label="Restaurar compras"
          variant="ghost"
          disabled={purchase.busy}
          onPress={() => void purchase.restore()}
        />
        <Text role="body" size="xs" color="muted" style={styles.centered}>
          En iPhone pagas con Apple y en Android con Google Play. Allfit no ve tu tarjeta y
          suscribirte no comparte tus datos con nadie.
        </Text>
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
  heading: { gap: 6 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  price: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  compareHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  column: { width: 84, textAlign: 'right' },
  grow: { flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  centered: { textAlign: 'center' },
})
