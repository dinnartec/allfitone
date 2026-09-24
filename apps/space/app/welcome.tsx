/**
 * Welcome screen.
 *
 * The photograph bleeds from the top edge with nothing layered over it. An
 * earlier pass framed it, textured it and drew a pulse line across it; four
 * competing layers is what made the screen feel crowded, not the image.
 *
 * The image is deliberately taller than the point where the scrim finishes
 * fading. If it stopped there, the last percent of the fade would still show
 * image and leave a visible horizontal seam.
 *
 * The frame is measured, not declared. Both a percentage height and a style
 * `aspectRatio` left the final size up to the layout engine, and on device it
 * resolved to something far taller than the asset — `cover` then scaled to fill
 * and cropped away everything but the subject's head. Computing the height from
 * the window and the asset's own ratio removes the ambiguity: the box always
 * matches the image, so there is nothing to crop.
 *
 * No ambient backdrop here. The photograph already fills the top two thirds, and
 * a wash underneath it competes instead of supporting — the blooms belong on the
 * sparse screens that have nothing else in them.
 *
 * The headline promises what the person came for. An earlier version led with
 * the Fitness ID — that the history belongs to them — which is a retention
 * argument sold to someone who has not yet had the problem. That promise now
 * lands where it decides something: accepting a gym's invitation.
 */

import { ProductLockup } from '@allfitone/react-native/brand'
import { Button } from '@allfitone/react-native/button'
import { GlassPanel } from '@allfitone/react-native/glass'
import { Scrim } from '@allfitone/react-native/gradient'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useRouter } from 'expo-router'

import welcomeHero from '../assets/images/welcome-backlit.webp'

// Kept named so the wording is one line to change while the copy is still open.
const HEADLINE = 'Entrena con plan,\nno con suerte'
const SUBHEAD =
  'Entrena por tu cuenta o con tu entrenador, registra lo que comes y lleva todo tu progreso en el mismo sitio.'

// The asset's own ratio, so the rendered box always matches the file.
const HERO_ASPECT = 1050 / 1546
// The scrim runs 6% taller than the image and finishes fading at 78% of itself,
// so it reaches the canvas colour well before the image ends. If it finished at
// the image's edge, the last percent of the fade would still show image and
// leave a visible seam.
const SCRIM_OVERHANG = 1.06
const SCRIM_COVERAGE = 0.78

export default function Welcome() {
  const theme = useTheme()
  const router = useRouter()
  const { width } = useWindowDimensions()

  const heroHeight = width / HERO_ASPECT
  const scrimHeight = heroHeight * SCRIM_OVERHANG

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background.canvas }]}>
      <Image
        source={welcomeHero}
        style={[styles.hero, { width, height: heroHeight }]}
        resizeMode="cover"
        accessible={false}
      />
      <Scrim height={scrimHeight} coverage={SCRIM_COVERAGE} />

      <Screen edges={['top', 'bottom']} dots style={styles.screen}>
        {/* The product lockup, not the ecosystem one: DT-001 reserves "Allfit
            One" for the ecosystem and this is a Space surface. Always the
            dark-surface variant, because it sits on imagery where a
            theme-driven mark would go dark against a dark photograph. */}
        <ProductLockup
          product="space"
          surface="dark"
          height={26}
          accessibilityLabel="Allfit Space"
          style={styles.lockup}
        />

        <View style={styles.spacer} />

        <View style={styles.copy}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            {HEADLINE}
          </Text>
          <Text role="body" size="md" color="secondary">
            {SUBHEAD}
          </Text>
        </View>

        <GlassPanel radius="panel" style={styles.actions}>
          <Button label="Crear mi cuenta" onPress={() => router.push('/create-account')} />
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/sign-in')}
            style={styles.signIn}
          >
            <Text role="body" size="sm" color="secondary" align="center">
              ¿Ya tienes cuenta?{' '}
              <Text role="control" size="sm" color="accent">
                Iniciar sesión
              </Text>
            </Text>
          </Pressable>
        </GlassPanel>
      </Screen>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  screen: {
    backgroundColor: 'transparent',
  },
  lockup: {
    // The safe area alone leaves the mark level with the status bar, which reads
    // as chrome rather than as the product signing the screen.
    marginTop: 16,
  },
  spacer: {
    flex: 1,
  },
  copy: {
    gap: 12,
    marginBottom: 24,
  },
  actions: {
    padding: 16,
    gap: 4,
  },
  signIn: {
    minHeight: 44,
    justifyContent: 'center',
  },
})
