/**
 * Root layout.
 *
 * Two things have to be true before any screen renders: the brand faces are
 * registered, and a theme is in context. Neither fails loudly on its own — text
 * drawn before the faces load silently uses the platform font and reflows when
 * they arrive, which reads as a flash of restyled content.
 *
 * The theme follows the device. An earlier version pinned dark on the grounds
 * that Space has no screen calling for light; that made the system switch appear
 * broken, which is a worse answer than an occasional rough light screen. DT-009
 * makes light a first-class semantic theme, and every screen is written against
 * the theme context, so following the system costs nothing structural.
 *
 * Navigation uses the platform push rather than a cross-fade. A fade between two
 * full screens has to be slow enough to avoid flashing the background through
 * the middle of it, which is why it felt sluggish; the native slide is shorter
 * and, more to the point, matches what every other iOS app does when going back.
 * The opening keeps its fade, because there is no spatial relationship between a
 * splash and the screen after it.
 *
 * **The tabs are a navigator, not screens on this stack.** They live in `(tabs)`,
 * which owns their transition and keeps them mounted; this stack only knows the group
 * exists. Everything that used to be here to make three stack peers behave — a
 * cross-fade, a duration, a list of their names — went with them.
 *
 * **A session is a mode, not a page.** It rises from the bottom, which is what an app
 * uses for something you are inside and then leave, and its back gesture is off: half
 * a swipe should not drop somebody out of the workout they are recording.
 *
 * It is **not** `presentation: 'fullScreenModal'`, which was tried. A modal is
 * presented in its own native view hierarchy and `SafeAreaView` reads no top inset
 * there, so the header sat across the clock and the battery. `initialWindowMetrics`
 * does not reach it either. A card with the same animation costs nothing and stays
 * inside the safe area.
 *
 * No `animationDuration` anywhere but the splash. It only applies to
 * `slide_from_bottom`, `fade_from_bottom`, `fade` and `simple_push` on iOS, so the
 * 220 that used to sit beside `slide_from_right` was configuring nothing, and the
 * platform's own timing is what makes a push feel native.
 */

import { useAllfitFonts } from '@allfitone/react-native/fonts'
import { ThemeProvider } from '@allfitone/react-native/theme'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { useReducedMotion } from 'react-native-reanimated'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

export default function RootLayout() {
  const { loaded, error } = useAllfitFonts()
  const scheme = useColorScheme()
  const reduceMotion = useReducedMotion()

  // A font that fails to load is not recoverable at runtime and must not be
  // hidden: rendering anyway would ship the wrong typeface without a trace.
  if (error) throw error
  if (!loaded) return null

  const theme = scheme === 'light' ? 'light' : 'dark'

  return (
    // Wraps the app once. Without it gestures do nothing and report no error,
    // which is the failure that looks like a broken animation.
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider theme={theme}>
          <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
          <Stack
            screenOptions={{
              headerShown: false,
              // Reduced motion keeps the change and drops the travel, which for a screen
              // transition is a cross-fade rather than nothing: something has to say the
              // screen changed.
              animation: reduceMotion ? 'fade' : 'slide_from_right',
            }}
          >
            <Stack.Screen name="welcome" options={{ animation: 'fade', animationDuration: 260 }} />
            {/* The group carries its own navigator, so this stack pushes it once and
                never animates between what is inside it. */}
            <Stack.Screen name="(tabs)" options={{ animation: 'fade', animationDuration: 160 }} />
            <Stack.Screen
              name="session/[executionId]"
              options={{
                animation: reduceMotion ? 'fade' : 'slide_from_bottom',
                gestureEnabled: false,
              }}
            />
            {/* The close of a session: it replaces it, so there is nothing to swipe back to. */}
            <Stack.Screen
              name="session/share/[executionId]"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            {/* The platform's own sheet: the session it explains stays in view beneath. */}
            <Stack.Screen
              name="how-to/[movementId]"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.92],
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
              }}
            />
          </Stack>
          {/* Withheld until onboarding completes: asking on the welcome screen,
            before the person knows what Allfit is, is not informed consent. */}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
