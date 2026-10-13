/**
 * `PRO-B` · Allfit Pro — `HU-SP-084`, `HU-SP-085`.
 *
 * The one place inside the app where Pro is bought, and the only way to pay is the
 * phone's own store. The photograph and the headline sell the idea; the price is the
 * store's, localized for the person, and it is the one that stays frozen while they
 * remain subscribed. The benefits are things that are true today, not functions product
 * has not decided yet.
 *
 * **`PRO-B2`.** Whoever already has Pro through a gym is told so where the price is, and
 * the button does not offer to charge them (`HU-SP-085` criterion 6): they already have
 * Pro, and a second charge would buy nothing. If that relationship ends, they can buy it.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Scrim } from '@allfitone/react-native/gradient'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import type { IconName } from '@allfitone/icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import heroPhoto from '../../assets/images/pro-hero.webp'
import {
  gymsOf,
  productFor,
  proPlanOf,
  storeName,
  subscriptionOf,
  type ProFlow,
  type ProStatus,
} from '../../src/client/pro'
import { deviceStore, loadOffer, type StoreOffer } from '../../src/client/pro-store'
import { createSpaceProFlow } from '../../src/client/pro-transport'
import { useProPurchase } from '../../src/components/use-pro-purchase'

const UNAVAILABLE = 'No pudimos cargar los planes. Revisa tu conexión e inténtalo de nuevo.'
const NOT_ON_SALE = 'Pro todavía no está a la venta en esta tienda.'
const PERIOD: Record<string, string> = { month: 'al mes', year: 'al año' }
const PER: Record<string, string> = { month: '/mes', year: '/año' }
const HERO_HEIGHT = 372
const FOOTER_HEIGHT = 150

const BENEFITS: readonly (readonly [IconName, string, string])[] = [
  ['training', 'Sin depender de un gimnasio', 'Pro es tuyo, entrenes donde entrenes.'],
  [
    'progress',
    'Más profundidad y volumen',
    'Programas y rutinas sin límite, comidas por foto y todo tu historial.',
  ],
  [
    'permissions',
    'Tus datos, siempre gratis',
    'Decidir qué compartes, verlo, descargarlo y borrarlo no se cobra.',
  ],
]

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
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [status, setStatus] = useState<ProStatus | undefined>(undefined)
  const [period, setPeriod] = useState<string | null>(null)
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
          const pro = proPlanOf(plans)
          setPeriod(pro?.billing_period ?? null)
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

  const paying = status ? subscriptionOf(status) : undefined
  const [gym] = status && status.effective_source === 'organization' ? gymsOf(status) : []
  const canBuy = Boolean(offer && status && !paying && !gym)
  const canvas = theme.color.background.canvas
  const label = paying
    ? 'Ya pagas Pro'
    : gym
      ? 'Ya tienes Pro por tu gimnasio'
      : offer
        ? `Suscribirme por ${offer.displayPrice}${period ? PER[period] : ''}`
        : `Suscribirme con ${storeName(deviceStore)}`

  return (
    <Screen edges={[]} padded={false} ambient={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: FOOTER_HEIGHT + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { height: HERO_HEIGHT + insets.top }]}>
          <Image
            source={heroPhoto}
            style={[styles.photo, { width, height: HERO_HEIGHT + insets.top }]}
            resizeMode="cover"
            accessible={false}
          />
          <Scrim height={HERO_HEIGHT + insets.top} coverage={1} onset={0.3} />
          <View style={styles.heroCopy}>
            <View
              style={[
                styles.seal,
                {
                  backgroundColor: theme.color.accent.tonal,
                  borderColor: theme.color.accent.tonalBorder,
                },
              ]}
            >
              <FoundationIcon
                name="favourite"
                size="sm"
                color={theme.color.icon.accent}
                decorative
              />
              <Text role="control" size="xs" color="accent">
                Allfit Pro
              </Text>
            </View>
            <Text role="display" size="5xl" uppercase accessibilityRole="header">
              {'Entrena sin\ndepender de nadie'}
            </Text>
            <Text role="body" size="sm" color="secondary">
              Todo Allfit, con o sin gimnasio. Tus datos siguen siendo tuyos en cualquier plan.
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {failure ? (
            <InlineAlert message={failure} tone={failure === NOT_ON_SALE ? 'info' : 'danger'} />
          ) : null}
          {purchase.failure ? <InlineAlert message={purchase.failure} /> : null}

          {gym ? (
            <View
              style={[
                styles.gymNotice,
                {
                  backgroundColor: theme.color.accent.tonal,
                  borderColor: theme.color.accent.tonalBorder,
                },
              ]}
            >
              <View
                style={[styles.monogram, { backgroundColor: theme.color.discipline.highIntensity }]}
              >
                <Text role="data" size="lg" style={{ color: theme.color.background.canvas }}>
                  {gym.organization_name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text role="control" size="sm">
                  Ya tienes Pro por {gym.organization_name}
                </Text>
                <Text role="body" size="xs" color="secondary">
                  Pagarlo solo te sirve para no depender de esa afiliación.
                </Text>
              </View>
            </View>
          ) : null}

          {offer ? (
            <View style={styles.price}>
              <View style={styles.priceRow}>
                <Text role="data" size="6xl">
                  {offer.displayPrice}
                </Text>
                <Text role="body" size="md" color="secondary">
                  {period ? PERIOD[period] : ''}
                </Text>
              </View>
              <View style={styles.inline}>
                <FoundationIcon
                  name="locked"
                  size="xs"
                  color={theme.color.icon.accent}
                  decorative
                />
                <Text role="control" size="xs" color="accent">
                  Tu precio no sube mientras sigas suscrito
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.benefits}>
            {BENEFITS.map(([icon, title, detail]) => (
              <View key={title} style={styles.benefit}>
                <View
                  style={[
                    styles.glyph,
                    {
                      backgroundColor: theme.color.accent.tonal,
                      borderColor: theme.color.accent.tonalBorder,
                    },
                  ]}
                >
                  <FoundationIcon
                    name={icon}
                    size="md"
                    color={theme.color.icon.accent}
                    decorative
                  />
                </View>
                <View style={styles.grow}>
                  <Text role="control" size="md">
                    {title}
                  </Text>
                  <Text role="body" size="xs" color="secondary">
                    {detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <IconButton
        icon="close"
        accessibilityLabel="Cerrar"
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + 6 }]}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <LinearGradient
          colors={[`${canvas}00`, canvas]}
          locations={[0, 0.28]}
          style={StyleSheet.absoluteFill}
        />
        <Button
          label={label}
          loading={purchase.busy}
          disabled={!canBuy}
          onPress={() => {
            if (offer && status && canBuy) void purchase.subscribe(offer, status.account_token)
          }}
        />
        <View style={styles.links}>
          <Pressable
            accessibilityRole="button"
            disabled={purchase.busy}
            onPress={() => void purchase.restore()}
          >
            <Text role="control" size="xs">
              Restaurar compras
            </Text>
          </Pressable>
          <Text role="body" size="xs" color="muted">
            ·
          </Text>
          <Text role="body" size="xs" color="muted">
            Cancela cuando quieras
          </Text>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { justifyContent: 'flex-end' },
  photo: { position: 'absolute', top: 0, left: 0 },
  heroCopy: { paddingHorizontal: 24, paddingBottom: 22, gap: 10 },
  seal: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  body: { paddingHorizontal: 24, gap: 22 },
  gymNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  monogram: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  price: { gap: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benefits: { gap: 16 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, gap: 2 },
  close: { position: 'absolute', left: 24 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 22,
    gap: 12,
  },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14 },
})
