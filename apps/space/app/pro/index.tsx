/**
 * `PRO-A1`, `PRO-A2`, `PRO-A3` · Tu plan — `HU-SP-086`, `HU-SP-087`, `HU-SP-088`.
 *
 * One screen for the three ways a person stands: Pro through a gym, Pro they pay for, or
 * the free plan. What decides is the API's `effective_source`; the membership card says
 * it, and the rest of the screen only answers what that means: what is included, where
 * the payments are, how to leave.
 *
 * **Cancelling happens in the store** (`PRO-C`). Apple and Google allow nothing else, so
 * the sheet says what stays the same, keeps «Mantener Pro» as the main act, and opens the
 * store's own subscriptions.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import invitePhoto from '../../assets/images/pro-invite.webp'
import {
  billingOf,
  gymsOf,
  lastPaid,
  money,
  renewalLine,
  shortDate,
  sourceLine,
  storeName,
  subscriptionOf,
  WAITING_FOR_FEATURES,
  type ProFlow,
  type ProPayments,
  type ProPlanCatalogue,
  type ProStatus,
  type SubscriptionSource,
} from '../../src/client/pro'
import { manageSubscription } from '../../src/client/pro-store'
import { createSpaceProFlow } from '../../src/client/pro-transport'
import {
  FeatureList,
  LinkPanel,
  MembershipCard,
  Note,
  SectionLabel,
  type CardFact,
  type PanelLink,
} from '../../src/components/pro-ui'

const UNAVAILABLE = 'No pudimos cargar tu plan. Revisa tu conexión e inténtalo de nuevo.'
// Dark under the words, clear by three quarters, where the athlete stands.
const INVITE_VEIL = ['#05090FF7', '#05090FB8', '#05090F00'] as const
const INVITE_VEIL_STOPS = [0, 0.42, 0.78] as const

export default function ProPlanRoute() {
  const flow = useMemo(() => createSpaceProFlow(), [])
  return <ProPlan flow={flow} />
}

/** The screen itself, given its flow: the route passes the real one. */
export function ProPlan({ flow }: { readonly flow: ProFlow }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [status, setStatus] = useState<ProStatus | undefined>(undefined)
  const [payments, setPayments] = useState<ProPayments | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ProPlanCatalogue | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [cancelling, setCancelling] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let active = true
      Promise.all([flow.read(), flow.payments(), flow.plans()])
        .then(([read, paid, plans]) => {
          if (!active) return
          setStatus(read)
          setPayments(paid)
          setCatalogue(plans)
          setFailure(undefined)
        })
        .catch(() => active && setFailure(UNAVAILABLE))
      return () => {
        active = false
      }
    }, [flow]),
  )

  const subscription = status ? subscriptionOf(status) : undefined
  const [gym] = status ? gymsOf(status) : []
  const charges = payments?.payments ?? []
  const paid = lastPaid(charges)

  const facts: CardFact[] = []
  if (status?.effective_source === 'subscription' && subscription) {
    facts.push({
      label: subscription.auto_renews ? 'Renovación' : 'Vencimiento',
      value: shortDate(subscription.current_period_end),
    })
    const amount = paid ? money(paid.amount_minor, paid.currency_code) : undefined
    if (amount) {
      const billing = billingOf(catalogue, subscription.version_id)
      facts.push({ label: billing.fee, value: `${amount}${billing.per}` })
    }
  } else if (status?.effective_source === 'organization' && gym) {
    facts.push(
      { label: 'Gimnasio', value: gym.organization_name },
      { label: 'En la app', value: 'No pagas nada' },
    )
  }

  const links: PanelLink[] = []
  links.push({
    icon: 'overview',
    title: 'Qué incluye cada plan',
    caption: 'Gratis y Pro, lado a lado',
    onPress: () => router.push('/pro/plans'),
  })
  if (subscription || charges.length > 0) {
    links.push({
      icon: 'history',
      title: 'Tus pagos',
      caption: paid
        ? `${charges.length} cobros · el último el ${shortDate(paid.occurred_at)}`
        : `${charges.length} cobros`,
      onPress: () => router.push('/pro/payments'),
    })
  }
  if (subscription) {
    links.push({
      icon: 'external',
      title: `Gestionar en ${subscription.store === 'google_play' ? 'Google Play' : 'App Store'}`,
      caption: 'Cambiar o cancelar la suscripción',
      onPress: () => void manageSubscription(undefined),
    })
  }

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tu plan
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} /> : null}

        {status ? (
          <>
            <MembershipCard pro={status.is_pro} source={sourceLine(status)} facts={facts} />

            {status.effective_source === 'organization' && gym ? (
              <Note icon="info">
                Lo tienes mientras sigas en {gym.organization_name} y el gimnasio esté activo. Si
                eso cambia, pasas al plan gratis sin perder nada.
              </Note>
            ) : null}

            {subscription && subscription.status !== 'active' ? (
              <InlineAlert message={renewalLine(subscription)} tone="warning" />
            ) : null}

            {!status.is_pro ? <ProInvitation onPress={() => router.push('/pro/plans')} /> : null}

            <View style={styles.section}>
              <SectionLabel>Lo que incluye</SectionLabel>
              <FeatureList
                features={status.features}
                pro={status.is_pro}
                waiting={WAITING_FOR_FEATURES}
              />
            </View>

            {links.length > 0 ? <LinkPanel links={links} /> : null}

            {!status.is_pro ? (
              <Note icon="organization">Si un gimnasio te invita, entras con Pro sin pagar.</Note>
            ) : null}

            {subscription ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCancelling(true)}
                style={styles.cancel}
              >
                <Text role="control" size="sm" color="muted" align="center">
                  Cancelar Pro
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {subscription ? (
        <CancelSheet
          visible={cancelling}
          subscription={subscription}
          onDismiss={() => setCancelling(false)}
        />
      ) : null}
    </Screen>
  )
}

/** `PRO-A3`'s invitation: the paywall's athlete, cropped wide and mirrored to the light side. */
function ProInvitation({ onPress }: { readonly onPress: () => void }) {
  const theme = useTheme()
  // Measured, because an absolutely filled image is drawn at its own size on iOS.
  const [size, setSize] = useState({ width: 0, height: 0 })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Conoce Allfit Pro"
      onPress={onPress}
      onLayout={(event) =>
        setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      style={[styles.invite, { borderColor: theme.color.accent.tonalBorder }]}
    >
      <Image
        source={invitePhoto}
        style={[styles.invitePhoto, size]}
        resizeMode="cover"
        accessible={false}
      />
      <LinearGradient
        colors={INVITE_VEIL}
        locations={INVITE_VEIL_STOPS}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.inviteCopy}>
        <View style={styles.seal}>
          <FoundationIcon name="favourite" size="sm" color={theme.color.icon.accent} decorative />
          <Text role="control" size="xs" color="accent">
            Allfit Pro
          </Text>
        </View>
        <Text role="display" size="2xl" uppercase>
          {'Todo Allfit, sin depender\nde un gimnasio'}
        </Text>
      </View>
      <View style={styles.inviteButton}>
        <Button label="Conoce Pro" size="sm" onPress={onPress} />
      </View>
    </Pressable>
  )
}

const KEEPS = [
  ['history', 'No se borra ningún dato. Pasas al plan gratis y sigues viendo todo tu historial.'],
  ['people', 'Tus permisos y tus gimnasios no cambian.'],
  ['organization', 'Si un gimnasio activo te afilia, recuperas Pro sin pagar.'],
] as const

function CancelSheet({
  visible,
  subscription,
  onDismiss,
}: {
  readonly visible: boolean
  readonly subscription: SubscriptionSource
  readonly onDismiss: () => void
}) {
  const theme = useTheme()
  const store = storeName(subscription.store)
  return (
    <Sheet visible={visible} onDismiss={onDismiss} title="¿Cancelar Allfit Pro?">
      <View style={styles.sheet}>
        <View
          style={[
            styles.until,
            {
              backgroundColor: theme.color.accent.tonal,
              borderColor: theme.color.accent.tonalBorder,
            },
          ]}
        >
          <FoundationIcon name="calendar" size="sm" color={theme.color.icon.accent} decorative />
          <Text role="control" size="xs" color="accent">
            Sigues con Pro hasta el {shortDate(subscription.current_period_end)}
          </Text>
        </View>
        {KEEPS.map(([icon, line]) => (
          <Note key={line} icon={icon}>
            {line}
          </Note>
        ))}
        <Text role="body" size="xs" color="muted">
          Lo pagas con {store}, así que se cancela en tu cuenta de {store}.
        </Text>
        <Button label="Mantener Pro" onPress={onDismiss} />
        <Button
          label={`Cancelar en ${subscription.store === 'google_play' ? 'Google Play' : 'App Store'}`}
          variant="secondary"
          onPress={() => {
            onDismiss()
            void manageSubscription(undefined)
          }}
        />
      </View>
    </Sheet>
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
  section: { gap: 4 },
  cancel: { paddingVertical: 8 },
  seal: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  invite: {
    minHeight: 196,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 20,
    gap: 12,
    justifyContent: 'flex-end',
  },
  invitePhoto: { position: 'absolute', top: 0, left: 0 },
  inviteCopy: { gap: 4, maxWidth: 270 },
  inviteButton: { alignSelf: 'flex-start' },
  sheet: { gap: 16 },
  until: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
})
