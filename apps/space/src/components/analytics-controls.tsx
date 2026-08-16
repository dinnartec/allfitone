import { Button } from '@allfitone/react-native/button'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { ANALYTICS_PRIVACY_NOTICE_URL, type TelemetryScreen } from '@allfitone/telemetry'
import { usePathname } from 'expo-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Linking, StyleSheet, View } from 'react-native'

import {
  captureSpaceTelemetry,
  initializeSpaceTelemetry,
  setSpaceAnalyticsConsent,
  spaceTelemetryCommon,
  spaceTelemetrySnapshot,
  subscribeSpaceTelemetry,
} from '../client/telemetry'

const APP_STARTED_AT = Date.now()

export function AnalyticsControls() {
  const theme = useTheme()
  const state = useSyncExternalStore(
    subscribeSpaceTelemetry,
    spaceTelemetrySnapshot,
    spaceTelemetrySnapshot,
  )
  const [expanded, setExpanded] = useState(false)
  const pathname = usePathname()
  const navigationStartedAt = useRef(APP_STARTED_AT)

  useEffect(() => {
    void initializeSpaceTelemetry()
  }, [])

  useEffect(() => {
    if (!state.active) return
    const now = Date.now()
    captureSpaceTelemetry({
      event: 'client.screen.viewed.v1',
      properties: { ...spaceTelemetryCommon(), screen: spaceScreen(pathname) },
    })
    captureSpaceTelemetry({
      event: 'client.performance.measured.v1',
      properties: {
        ...spaceTelemetryCommon(),
        metric: pathname === '/' ? 'app_start' : 'screen_transition',
        value: Math.max(0, now - navigationStartedAt.current),
        rating: 'unrated',
      },
    })
    navigationStartedAt.current = now
  }, [pathname, state.active])

  const open = state.decision === 'undecided' || expanded
  return (
    <View
      style={[styles.root, open ? styles.rootExpanded : styles.rootCollapsed]}
      pointerEvents="box-none"
    >
      {open ? (
        <View
          accessibilityRole="summary"
          style={[
            styles.panel,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
              borderRadius: theme.semanticRadius.card,
            },
          ]}
        >
          <Text role="control" size="md">
            Analítica opcional
          </Text>
          <Text role="body" size="sm" color="secondary">
            Mide rendimiento y uso con un seudónimo. Nunca capturamos contenido, nombres, correos ni
            datos de salud.
          </Text>
          <Button
            label="Leer el aviso completo"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(ANALYTICS_PRIVACY_NOTICE_URL)
            }}
          />
          <View style={styles.actions}>
            <Button
              label="Permitir analítica"
              onPress={() => {
                void setSpaceAnalyticsConsent('granted')
                setExpanded(false)
              }}
            />
            <Button
              label="No permitir"
              variant="secondary"
              onPress={() => {
                void setSpaceAnalyticsConsent('denied')
                setExpanded(false)
              }}
            />
          </View>
        </View>
      ) : (
        <Button label="Privacidad" variant="secondary" onPress={() => setExpanded(true)} />
      )}
    </View>
  )
}

function spaceScreen(pathname: string): TelemetryScreen {
  if (pathname === '/create-account') return 'space.create_account'
  if (pathname === '/verify-email') return 'space.verify_email'
  if (pathname === '/sign-in') return 'space.sign_in'
  return 'space.welcome'
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    alignItems: 'flex-end',
  },
  rootExpanded: {
    top: 16,
    right: 16,
    left: 16,
  },
  rootCollapsed: {
    right: 16,
    bottom: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    padding: 16,
    gap: 10,
    borderWidth: 1,
  },
  actions: {
    gap: 8,
  },
})
