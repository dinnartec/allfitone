/**
 * Opening screen.
 *
 * The fill lives in the design system as `BrandEntrance`, because clipping to
 * the mark needs the logo geometry and products are kept out of the brand
 * package. A first version clipped to a rectangle instead and the fill edge ran
 * visibly past the silhouette.
 *
 * Timings are deliberate: the fill lands at 1.5s and the sequence ends at 2.8s.
 * An earlier pass ran six hundred milliseconds slower and felt like waiting.
 * Anything longer is charming once and irritating from the second launch.
 *
 * Where it goes next is not this screen's decision. An earlier version always
 * replaced with the welcome screen, which asked somebody who had just signed in
 * to create an account again — HU-SP-002 criterion 4. Reading the stored session
 * happens here; choosing the destination lives in `session-gate`, where it can be
 * tested without launching the app.
 */

import { BrandEntrance } from '@allfitone/react-native/brand-entrance'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native'

import { resolveEntryRoute } from '../src/client/session-gate'
import { readSession } from '../src/client/session'

const FILL_MS = 1500
const POWERED_DELAY_MS = 2050
const EXIT_MS = 2800
const REDUCED_EXIT_MS = 800

export default function Opening() {
  const theme = useTheme()
  const router = useRouter()
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null)
  const [route, setRoute] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    readSession()
      .then((session) => {
        if (active) setRoute(resolveEntryRoute({ session }))
      })
      .catch(() => {
        // Unreadable storage is not a signed-in state, and it must not hang the
        // opening on a screen with no way forward.
        if (active) setRoute(resolveEntryRoute({ session: null }))
      })
    return () => {
      active = false
    }
  }, [])

  const name = useRef(new Animated.Value(0)).current
  const powered = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let active = true
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (reduceMotion === null || route === null) return

    if (reduceMotion) {
      name.setValue(1)
      powered.setValue(1)
    } else {
      Animated.parallel([
        Animated.timing(name, {
          toValue: 1,
          duration: 700,
          delay: FILL_MS - 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(powered, {
          toValue: 1,
          duration: 650,
          delay: POWERED_DELAY_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start()
    }

    const timer = setTimeout(
      () => router.replace(route as '/welcome'),
      reduceMotion ? REDUCED_EXIT_MS : EXIT_MS,
    )
    return () => clearTimeout(timer)
  }, [reduceMotion, route, name, powered, router])

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background.canvas }]}>
      <View style={styles.core}>
        <BrandEntrance
          width={64}
          height={182}
          durationMs={FILL_MS}
          reduceMotion={reduceMotion === true}
          accessibilityLabel="Allfit Space"
        />

        <Animated.View
          style={{
            opacity: name,
            transform: [
              { translateY: name.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          <Text role="display" size="4xl" uppercase style={styles.wordmark}>
            Space
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.powered, { opacity: powered }]}>
        <Text role="body" size="xs" color="muted" align="center">
          Powered by Allfit One
        </Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    alignItems: 'center',
    gap: 14,
    marginTop: -30,
  },
  wordmark: {
    // Wide tracking so the product name reads as a companion to the mark rather
    // than competing with it.
    letterSpacing: 9,
  },
  powered: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
  },
})
