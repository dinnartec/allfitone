/**
 * «Compártelo»: the close of a finished session (FIN-17a, HU-SP-111, ADR-036).
 *
 * The session has already been saved when this opens; nothing here writes to Allfit.
 * The summary is read once, the cards are drawn from it, and every action works on an
 * image made on the phone.
 *
 * **The photograph never leaves the phone.** «Fondo» picks one from the gallery for the
 * photo card and keeps it in memory: it is not uploaded, not stored and gone when the
 * screen closes. Without one the card uses the routine's own cover, the same as Hoy.
 *
 * **What is shared is captured apart from what is shown.** The carousel scales its
 * cards to the phone, so a copy of the card in view is drawn off screen on a 360-point
 * canvas and captured at 1080 × 1920, a story's size, whatever the phone. The card sits
 * inside that canvas with a margin, as a card: full bleed it filled the whole story,
 * and in Instagram that read as shouting.
 *
 * **«Historias» opens Instagram's story composer** with the card as a sticker over the
 * card's own two inks, so the person can place and resize it there. It needs Meta's
 * app id (`EXPO_PUBLIC_META_APP_ID`) and Instagram on the phone; without either it
 * opens the system sheet, as «Más» always does.
 *
 * **Leaving is always «Terminar».** There is no back to the session: it is closed.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { PageDots } from '@allfitone/react-native/page-dots'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { InstagramGlyph, instagramGradient } from '@allfitone/react-native/third-party'
import { Toast } from '@allfitone/react-native/toast'
import { useTheme } from '@allfitone/react-native/theme'
import { color, semanticMotion } from '@allfitone/react-native/tokens'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import * as MediaLibrary from 'expo-media-library'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  PixelRatio,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Share, { Social } from 'react-native-share'
import { captureRef } from 'react-native-view-shot'
import { scheduleOnRN } from 'react-native-worklets'

import { createSpaceContentFlow } from '../../../src/client/content-transport'
import { readExerciseLibrary } from '../../../src/client/exercise-library'
import { createSpaceExecutionFlow } from '../../../src/client/execution-transport'
import {
  cardScale,
  cardsFor,
  restoreLabel,
  shareSubtitle,
  storyRoute,
  type CardKind,
  type ShareSummary,
} from '../../../src/client/share-cards'
import { deviceTimezone } from '../../../src/client/timezone'
import {
  CARD_WIDTH,
  Scaled,
  ShareCard,
  type ShareCatalogue,
} from '../../../src/components/share-card'

/** The gap between two cards in the carousel, as FIN-17a spaces them. */
const GAP = 27
/** Header, dots, the actions and «Terminar»: what the card shares the screen with. */
const CHROME = 330
/** The story's canvas in points: 360 at the phone's 3× is a 1080 × 1920 image. */
const CANVAS = { width: 360, height: 640 } as const
/** The card fills 80 % of the story's width, centred, so it reads as a card. */
const CAPTURE_SCALE = (CANVAS.width * 0.8) / CARD_WIDTH
const STORY = { width: 1080, height: 1920 } as const
/** The story's ground behind the sticker: the card's own gradient, top to foot. */
const STORY_INKS = { top: '#0D1D28', bottom: color.ink.void } as const

/** Past the sheet's exit for iOS to drop its modal: 80 ms was not enough, 350 is. */
const SHEET_GONE = 350

/** Just above the dots: over the foot of the card, clear of the title and the actions. */
const TOAST_FROM_BOTTOM = 214

const LOAD_FAILED = 'No pudimos preparar tus tarjetas. Tu entreno ya quedó guardado.'
const SAVE_FAILED = 'No pudimos guardar la imagen. Inténtalo de nuevo.'
const SHARE_FAILED = 'No pudimos preparar la imagen. Inténtalo de nuevo.'
const NO_PERMISSION = 'Para guardarla, permite a Allfit añadir fotos en Ajustes.'

type Notice = { readonly tone: 'done' | 'failed'; readonly text: string }

export default function ShareSessionScreen() {
  const { executionId } = useLocalSearchParams<{ executionId: string }>()
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion()
  const { width, height } = useWindowDimensions()

  const [summary, setSummary] = useState<ShareSummary | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ShareCatalogue>({ movements: [], muscles: [] })
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(0)
  /** A picture from the gallery, held only while this screen is open. */
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Asking what to do with a picture already picked: another one, or none. */
  const [choosing, setChoosing] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  const deck = useRef<Animated.ScrollView>(null)
  const capture = useRef<View>(null)
  /** The card alone, with no canvas round it: Instagram draws its own ground. */
  const sticker = useRef<View>(null)
  const timeZone = deviceTimezone()

  useEffect(() => {
    let active = true
    // The library names the muscles; without it the cards still say everything else.
    Promise.all([
      createSpaceExecutionFlow().readSummary(executionId, timeZone),
      readExerciseLibrary(createSpaceContentFlow()).catch(() => undefined),
    ])
      .then(([read, library]) => {
        if (!active) return
        setSummary(read)
        setCatalogue({ movements: library?.movements ?? [], muscles: library?.muscles ?? [] })
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [executionId, timeZone])

  const done = () => router.replace('/today')

  const scale = cardScale(width, height - insets.top - insets.bottom - CHROME)
  const cardWidth = CARD_WIDTH * scale
  const interval = cardWidth + GAP
  const kinds: readonly CardKind[] = summary ? cardsFor(summary) : []

  // As on Hoy: the dots follow the finger on the UI thread, and the card in front
  // changes as the half is crossed, not when the scroll comes to rest.
  const at = useSharedValue(0)
  const follow = useAnimatedScrollHandler((event) => {
    at.set(event.contentOffset.x / interval)
  })
  useAnimatedReaction(
    () => Math.round(at.get()),
    (now, before) => {
      if (now !== before) scheduleOnRN(setPage, Math.max(0, now))
    },
  )
  const shown = kinds[page] ?? 'photo'
  const photo = picked ?? summary?.cover_url ?? null

  const say = (next: Notice) => {
    setNotice(next)
    if (next.tone === 'done')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  /** Draws the card in view off screen at story size and hands its file over. */
  const image = (result: 'tmpfile' | 'base64') =>
    // View-shot sizes in points and multiplies by the screen's ratio itself.
    captureRef(capture, {
      format: 'png',
      quality: 1,
      result,
      width: STORY.width / PixelRatio.get(),
      height: STORY.height / PixelRatio.get(),
    })

  const run = (action: () => Promise<Notice | undefined>, failure: string) => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    action()
      .then((next) => next && say(next))
      .catch(() => say({ tone: 'failed', text: failure }))
      .finally(() => setBusy(false))
  }

  const story = () =>
    run(async () => {
      const appId = process.env.EXPO_PUBLIC_META_APP_ID
      const installed = await Linking.canOpenURL('instagram-stories://share').catch(() => false)
      if (storyRoute(appId, installed) === 'sheet' || !appId) return sheet()
      const png = await captureRef(sticker, { format: 'png', quality: 1, result: 'base64' })
      await Share.shareSingle({
        social: Social.InstagramStories,
        appId,
        stickerImage: `data:image/png;base64,${png}`,
        backgroundTopColor: STORY_INKS.top,
        backgroundBottomColor: STORY_INKS.bottom,
      })
      return undefined
    }, SHARE_FAILED)

  /** The system sheet: every app the phone has, Instagram among them. */
  const sheet = async (): Promise<undefined> => {
    const uri = await image('tmpfile')
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Compartir tu entreno',
    })
    return undefined
  }

  const share = () => run(sheet, SHARE_FAILED)

  const save = () =>
    run(async () => {
      const permission = await MediaLibrary.requestPermissionsAsync(true)
      if (!permission.granted) return { tone: 'failed', text: NO_PERMISSION }
      await MediaLibrary.Asset.create(await image('tmpfile'))
      return { tone: 'done', text: 'Guardada en Fotos.' }
    }, SAVE_FAILED)

  const copy = () =>
    run(async () => {
      await Clipboard.setImageAsync(await image('base64'))
      return { tone: 'done', text: 'Imagen copiada.' }
    }, SHARE_FAILED)

  // The system picker needs no permission: it hands back only the picture chosen.
  const pick = () =>
    run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] })
      const chosen = result.canceled ? undefined : result.assets[0]?.uri
      if (!chosen) return undefined
      setPicked(chosen)
      const index = kinds.indexOf('photo')
      deck.current?.scrollTo({ x: index * interval, animated: !reduceMotion })
      return undefined
    }, SHARE_FAILED)

  // A picture already picked can be swapped or taken back; none yet goes straight in.
  const background = () => (picked ? setChoosing(true) : pick())

  const restore = () => {
    setChoosing(false)
    setPicked(null)
  }

  if (failed || !summary) {
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <View style={styles.waiting}>
          {failed ? (
            <InlineAlert message={LOAD_FAILED} />
          ) : (
            <ActivityIndicator color={theme.color.icon.accent} />
          )}
        </View>
        <View style={styles.finish}>
          <Button label="Terminar" variant="secondary" onPress={done} />
        </View>
      </Screen>
    )
  }

  const actions: readonly {
    readonly label: string
    readonly icon: IconName | 'instagram'
    readonly onPress: () => void
  }[] = [
    { label: 'Fondo', icon: 'image', onPress: background },
    { label: 'Historias', icon: 'instagram', onPress: story },
    { label: 'Guardar', icon: 'download', onPress: save },
    { label: 'Copiar', icon: 'duplicate', onPress: copy },
    { label: 'Más', icon: 'more', onPress: share },
  ]

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <Text role="control" size="lg" align="center" accessibilityRole="header">
          Compártelo
        </Text>
        <Text role="body" size="sm" color="muted" align="center" numberOfLines={1}>
          {shareSubtitle(summary)}
        </Text>
      </View>

      <Animated.ScrollView
        ref={deck}
        horizontal
        onScroll={follow}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={interval}
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: (width - cardWidth) / 2, gap: GAP }}
        style={styles.deck}
        testID="share-deck"
      >
        {kinds.map((kind) => (
          <View key={kind} accessible accessibilityLabel={`Tarjeta ${kind}`}>
            <Scaled scale={scale}>
              <ShareCard
                kind={kind}
                summary={summary}
                catalogue={catalogue}
                timeZone={timeZone}
                photo={photo}
              />
            </Scaled>
          </View>
        ))}
      </Animated.ScrollView>

      <PageDots
        count={kinds.length}
        active={page}
        at={at}
        accessibilityLabel="Tarjetas"
        reduceMotion={reduceMotion}
        style={styles.dots}
      />

      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: busy }}
            style={styles.action}
            testID={`share-${action.label}`}
          >
            {action.icon === 'instagram' ? (
              // Instagram's own mark on its own gradient, as Meta's guidelines show it.
              <LinearGradient
                colors={[...instagramGradient]}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={styles.round}
              >
                <InstagramGlyph size={24} decorative />
              </LinearGradient>
            ) : (
              <View
                style={[
                  styles.round,
                  {
                    backgroundColor: theme.color.background.surface,
                    borderColor: theme.color.border.subtle,
                    borderWidth: 1,
                  },
                ]}
              >
                <FoundationIcon
                  name={action.icon}
                  customSize={22}
                  color={theme.color.text.primary}
                  decorative
                />
              </View>
            )}
            <Text role="body" size="xs" color="muted">
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.finish}>
        <Button label="Terminar" variant="secondary" onPress={done} testID="share-finish" />
      </View>

      <Sheet visible={choosing} onDismiss={() => setChoosing(false)} title="Fondo de la tarjeta">
        <View style={styles.choices}>
          <Button
            label="Elegir otra foto"
            icon="image"
            onPress={() => {
              setChoosing(false)
              // iOS will not present the picker over a modal still leaving: wait it out.
              setTimeout(pick, semanticMotion.exit.duration + SHEET_GONE)
            }}
          />
          <Button
            label={restoreLabel(summary.cover_url)}
            variant="secondary"
            onPress={restore}
            testID="share-restore"
          />
        </View>
      </Sheet>

      {/* Gone on its own: a confirmation, not something to dismiss. */}
      <Toast
        message={notice?.text}
        tone={notice?.tone === 'failed' ? 'danger' : 'success'}
        reduceMotion={reduceMotion}
        onHide={() => setNotice(undefined)}
        style={[styles.toast, { bottom: insets.bottom + TOAST_FROM_BOTTOM }]}
        testID="share-toast"
      />

      {/* The copy that is captured: off screen, on the story's canvas. */}
      <View ref={capture} collapsable={false} style={styles.capture} pointerEvents="none">
        <View ref={sticker} collapsable={false}>
          <Scaled scale={CAPTURE_SCALE}>
            <ShareCard
              kind={shown}
              summary={summary}
              catalogue={catalogue}
              timeZone={timeZone}
              photo={photo}
            />
          </Scaled>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 2 },
  deck: { flexGrow: 0, marginTop: 16 },
  dots: { alignSelf: 'center', marginTop: 14, marginBottom: 20 },
  toast: { position: 'absolute', alignSelf: 'center' },
  choices: { gap: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  action: { width: 58, alignItems: 'center', gap: 7 },
  round: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finish: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  capture: {
    position: 'absolute',
    top: 0,
    left: -CANVAS.width * 2,
    width: CANVAS.width,
    height: CANVAS.height,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ink.void,
  },
})
