/**
 * `PRO-1`, `PRO-3`, `PRO-5` · Tu plan — `HU-SP-086`, `HU-SP-087`, `HU-SP-088`.
 *
 * One screen for the three ways a person stands: Pro through a gym, Pro they pay for, or
 * the free plan. What decides is the API's `effective_source`; this screen says it in
 * words and never infers a plan from what it does not see.
 *
 * **Cancelling happens in the store.** Apple and Google allow nothing else, so the sheet
 * explains what changes and what does not, and opens the store's own subscriptions.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { ContentRow } from '@allfitone/react-native/content-row'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import {
  gymsOf,
  lastPaid,
  limitLabel,
  money,
  renewalLine,
  sourceLine,
  storeName,
  subscriptionOf,
  WAITING_FOR_FEATURES,
  type ProFlow,
  type ProPayments,
  type ProStatus,
} from '../../src/client/pro'
import { manageSubscription } from '../../src/client/pro-store'
import { createSpaceProFlow } from '../../src/client/pro-transport'

const UNAVAILABLE = 'No pudimos cargar tu plan. Revisa tu conexión e inténtalo de nuevo.'
const KEEPS = [
  'No se borra ningún dato. Pasas al plan gratis y sigues viendo todo tu historial.',
  'Tus permisos y tus gimnasios no cambian.',
  'Si te afilia un gimnasio activo, recuperas Pro sin pagar.',
]

export default function ProPlanRoute() {
  const flow = useMemo(() => createSpaceProFlow(), [])
  return <ProPlan flow={flow} />
}

/** The screen itself, given its flow: the route passes the real one. */
export function ProPlan({ flow }: { readonly flow: ProFlow }) {
  const router = useRouter()
  const theme = useTheme()
  const [status, setStatus] = useState<ProStatus | undefined>(undefined)
  const [payments, setPayments] = useState<ProPayments | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [cancelling, setCancelling] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let active = true
      Promise.all([flow.read(), flow.payments()])
        .then(([read, paid]) => {
          if (!active) return
          setStatus(read)
          setPayments(paid)
          setFailure(undefined)
        })
        .catch(() => active && setFailure(UNAVAILABLE))
      return () => {
        active = false
      }
    }, [flow]),
  )

  const subscription = status ? subscriptionOf(status) : undefined
  const gyms = status ? gymsOf(status) : []
  const paid = payments ? lastPaid(payments.payments) : undefined
  const card = {
    backgroundColor: theme.color.background.surface,
    borderColor: theme.color.border.subtle,
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header">
          Tu plan
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <InlineAlert message={failure} /> : null}

        {status ? (
          <>
            <View style={[styles.card, card]}>
              <View style={styles.planRow}>
                <View style={styles.grow}>
                  <Text role="display" size="xl">
                    {status.is_pro ? 'Allfit Pro' : 'Plan gratis'}
                  </Text>
                  <Text role="body" size="sm" color={status.is_pro ? 'accent' : 'muted'}>
                    {sourceLine(status)}
                  </Text>
                </View>
                {status.is_pro ? <Badge label="Activo" tone="success" variant="quiet" /> : null}
              </View>
              {status.effective_source === 'organization' && gyms[0] ? (
                <Text role="body" size="sm" color="secondary">
                  Lo tienes mientras sigas en {gyms[0].organization_name} y el gimnasio esté activo.
                  No pagas nada en la app.
                </Text>
              ) : null}
              {subscription ? (
                <View style={styles.facts}>
                  {paid ? (
                    <Fact
                      label="Pagas"
                      value={money(paid.amount_minor, paid.currency_code) ?? '—'}
                    />
                  ) : null}
                  <Fact label="Con" value={storeName(subscription.store)} />
                  <Fact label="Estado" value={renewalLine(subscription)} wide />
                </View>
              ) : null}
            </View>

            {gyms.length > 0 ? (
              <Section title="Tu afiliación">
                {gyms.map((gym) => (
                  <View key={gym.organization_id} style={[styles.gym, card]}>
                    <Text role="control" size="md">
                      {gym.organization_name}
                    </Text>
                    <Text role="body" size="sm" color="muted">
                      Incluye Pro
                    </Text>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section title={status.is_pro ? 'Tus límites hoy' : 'Lo que incluye tu plan'}>
              {status.features.length === 0 ? (
                <Text role="body" size="sm" color="muted">
                  {WAITING_FOR_FEATURES}
                </Text>
              ) : (
                status.features.map((feature) => (
                  <View key={feature.code} style={styles.limit}>
                    <Text role="body" size="sm" style={styles.grow}>
                      {feature.name}
                    </Text>
                    <Text role="control" size="sm" color="accent">
                      {limitLabel(feature)}
                    </Text>
                  </View>
                ))
              )}
            </Section>

            {!status.is_pro ? (
              <View style={[styles.card, card]}>
                <Text role="control" size="lg">
                  Allfit Pro
                </Text>
                <Text role="body" size="sm" color="secondary">
                  Todo Allfit, sin depender de un gimnasio.
                </Text>
                <Button label="Ver Pro" onPress={() => router.push('/pro/plans')} />
              </View>
            ) : null}

            <Section title="Más">
              {subscription || (payments?.payments.length ?? 0) > 0 ? (
                <ContentRow
                  name="Tus pagos a Allfit"
                  caption={`${payments?.payments.length ?? 0} cobros`}
                  trailing={{ kind: 'chevron' }}
                  onPress={() => router.push('/pro/payments')}
                />
              ) : null}
              <ContentRow
                name="Qué incluye cada plan"
                caption="Gratis y Pro, lado a lado"
                trailing={{ kind: 'chevron' }}
                onPress={() => router.push('/pro/plans')}
              />
            </Section>

            {!status.is_pro ? (
              <View style={styles.note}>
                <FoundationIcon
                  name="info"
                  size="sm"
                  color={theme.color.icon.secondary}
                  decorative
                />
                <Text role="body" size="xs" color="muted" style={styles.grow}>
                  Si un gimnasio te invita, entras con Pro sin pagar.
                </Text>
              </View>
            ) : null}

            {subscription ? (
              <Button label="Cancelar Pro" variant="ghost" onPress={() => setCancelling(true)} />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Sheet
        visible={cancelling}
        onDismiss={() => setCancelling(false)}
        title="¿Cancelar Allfit Pro?"
      >
        <View style={styles.sheet}>
          {subscription ? (
            <Text role="body" size="sm" color="secondary">
              Lo pagas con {storeName(subscription.store)}, así que se cancela en tu cuenta de{' '}
              {storeName(subscription.store)}. Sigues con Pro hasta el final del periodo que ya
              pagaste.
            </Text>
          ) : null}
          {KEEPS.map((line) => (
            <View key={line} style={styles.keep}>
              <FoundationIcon name="check" size="sm" color={theme.color.icon.accent} decorative />
              <Text role="body" size="sm" style={styles.grow}>
                {line}
              </Text>
            </View>
          ))}
          <Button
            label={`Gestionar en ${subscription?.store === 'google_play' ? 'Google Play' : 'App Store'}`}
            onPress={() => {
              setCancelling(false)
              void manageSubscription(undefined)
            }}
          />
          <Button label="Mantener Pro" variant="ghost" onPress={() => setCancelling(false)} />
        </View>
      </Sheet>
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
      <Text role="eyebrow" size="2xs" color="muted">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  )
}

function Fact({
  label,
  value,
  wide,
}: {
  readonly label: string
  readonly value: string
  readonly wide?: boolean
}) {
  return (
    <View style={wide ? styles.wide : styles.fact}>
      <Text role="body" size="xs" color="muted">
        {label}
      </Text>
      <Text role="control" size="sm">
        {value}
      </Text>
    </View>
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
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 18 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  fact: { gap: 2 },
  wide: { gap: 2, flexBasis: '100%' },
  section: { gap: 10 },
  gym: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 14, gap: 2 },
  limit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheet: { gap: 14 },
  keep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
})
