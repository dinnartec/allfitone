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
 */

import { useAllfitFonts } from '@allfitone/react-native/fonts'
import { ThemeProvider } from '@allfitone/react-native/theme'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

export default function RootLayout() {
  const { loaded, error } = useAllfitFonts()
  const scheme = useColorScheme()

  // A font that fails to load is not recoverable at runtime and must not be
  // hidden: rendering anyway would ship the wrong typeface without a trace.
  if (error) throw error
  if (!loaded) return null

  const theme = scheme === 'light' ? 'light' : 'dark'

  return (
    <SafeAreaProvider>
      <ThemeProvider theme={theme}>
        <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            animationDuration: 220,
          }}
        >
          <Stack.Screen name="welcome" options={{ animation: 'fade', animationDuration: 260 }} />
        </Stack>
        {/* Withheld until onboarding completes: asking on the welcome screen,
            before the person knows what Allfit is, is not informed consent. */}
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
