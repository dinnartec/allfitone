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
 * card's own two inks, so the person can place and resize it there. What every share
 * screen does with the picture lives in `share-actions`.
 *
 * **Imagen or Sticker, chosen at the top (FIN-SH2).** A sticker is the figures alone on
 * nothing, to go over a photograph of the person's own; the carousel previews each one
 * over the routine's cover or the picture picked, which is never part of the sticker.
 * It is drawn at twice its box for the capture, never scaled up, so it stays sharp.
 *
 * **Leaving is always «Terminar».** There is no back to the session: it is closed.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { PageDots } from '@allfitone/react-native/page-dots'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { Toast } from '@allfitone/react-native/toast'
import { useTheme } from '@allfitone/react-native/theme'
import { color, semanticMotion } from '@allfitone/react-native/tokens'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, PixelRatio, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import { scheduleOnRN } from 'react-native-worklets'

import sample from '../../../assets/images/today/today-hero.webp'
import { createSpaceContentFlow } from '../../../src/client/content-transport'
import { readExerciseLibrary } from '../../../src/client/exercise-library'
import { createSpaceExecutionFlow } from '../../../src/client/execution-transport'
import {
  cardScale,
  cardsFor,
  restoreLabel,
  shareSubtitle,
  stickersFor,
  type CardKind,
  type ShareSummary,
} from '../../../src/client/share-cards'
import { deviceTimezone } from '../../../src/client/timezone'
import {
  copyImage,
  openStory,
  saveFile,
  SAVE_FAILED,
  shareFile,
  ShareActionRow,
  SHARE_FAILED,
  useShareMode,
  useShareRun,
  type ShareAction,
  type ShareMode,
} from '../../../src/components/share-actions'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  Scaled,
  ShareCard,
  type ShareCatalogue,
} from '../../../src/components/share-card'
import { SESSION_STICKER_SIZE, SessionSticker } from '../../../src/components/session-stickers'

/** The gap between two cards in the carousel, as FIN-17a spaces them. */
const GAP = 27
/** Header, the switch, dots, the actions and «Terminar»: what the card shares the screen with. */
const CHROME = 390
/** The story's canvas in points: 360 at the phone's 3× is a 1080 × 1920 image. */
const CANVAS = { width: 360, height: 640 } as const
/** The card fills 80 % of the story's width, centred, so it reads as a card. */
const CAPTURE_SCALE = (CANVAS.width * 0.8) / CARD_WIDTH
const STORY = { width: 1080, height: 1920 } as const
/** The story's ground behind the sticker: the card's own gradient, top to foot. */
const STORY_INKS = { top: '#0D1D28', bottom: color.ink.void } as const

/** A sticker is drawn at twice its box for the capture, natively: enlarging blurs it. */
const STICKER_CAPTURE = 2
/** The width a sticker takes over the preview photograph. */
const PREVIEW_WIDTH = 260
const STICKER_HELP =
  'Copia el sticker y pégalo sobre tu foto en Instagram, o guárdalo sin fondo en tu galería.'

/** Past the sheet's exit for iOS to drop its modal: 80 ms was not enough, 350 is. */
const SHEET_GONE = 350

/** Just above the dots: over the foot of the card, clear of the title and the actions. */
const TOAST_FROM_BOTTOM = 214

const LOAD_FAILED = 'No pudimos preparar tus tarjetas. Tu entreno ya quedó guardado.'

export default function ShareSessionScreen() {
  const { executionId, back } = useLocalSearchParams<{ executionId: string; back?: string }>()
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion()
  const { width, height } = useWindowDimensions()

  const [summary, setSummary] = useState<ShareSummary | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ShareCatalogue>({ movements: [], muscles: [] })
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(0)
  const [mode, setMode] = useShareMode()
  /** A picture from the gallery, held only while this screen is open. */
  const [picked, setPicked] = useState<string | null>(null)
  const { busy, notice, clear, run } = useShareRun()
  /** Asking what to do with a picture already picked: another one, or none. */
  const [choosing, setChoosing] = useState(false)

  const deck = useRef<Animated.ScrollView>(null)
  const capture = useRef<View>(null)
  /** The card alone, with no canvas round it: Instagram draws its own ground. */
  const sticker = useRef<View>(null)
  /** The sticker in view, at twice its box, on nothing. */
  const transparent = useRef<View>(null)
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

  // From a session's detail it goes back there; right after training, to Hoy.
  const done = () => (back === '1' && router.canGoBack() ? router.back() : router.replace('/today'))

  const scale = cardScale(width, height - insets.top - insets.bottom - CHROME)
  const cardWidth = CARD_WIDTH * scale
  const interval = cardWidth + GAP
  const kinds: readonly CardKind[] = summary ? cardsFor(summary) : []
  const stickers = summary ? stickersFor(summary) : []

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
  const shownSticker = stickers[Math.min(page, stickers.length - 1)] ?? 'figures'

  const switchTo = (next: ShareMode) => {
    setMode(next)
    setPage(0)
    at.set(0)
    deck.current?.scrollTo({ x: 0, animated: false })
  }
  const photo = picked ?? summary?.cover_url ?? null

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

  const stickerImage = (result: 'tmpfile' | 'base64') =>
    captureRef(transparent, { format: 'png', quality: 1, result })

  const sheet = async () =>
    shareFile(
      await (mode === 'image' ? image('tmpfile') : stickerImage('tmpfile')),
      'Compartir tu entreno',
    )

  const story = () =>
    run(async () => {
      const png =
        mode === 'image'
          ? await captureRef(sticker, { format: 'png', quality: 1, result: 'base64' })
          : await stickerImage('base64')
      const background = mode === 'sticker' ? (picked ?? undefined) : undefined
      return (await openStory({ sticker: png, inks: STORY_INKS, background })) ? undefined : sheet()
    }, SHARE_FAILED)

  const share = () => run(sheet, SHARE_FAILED)

  const save = () =>
    run(
      async () =>
        mode === 'image'
          ? saveFile(await image('tmpfile'), 'Guardada en Fotos.')
          : saveFile(await stickerImage('tmpfile'), 'Sticker guardado sin fondo en Fotos.'),
      SAVE_FAILED,
    )

  const copy = () =>
    run(
      async () =>
        mode === 'image'
          ? copyImage(await image('base64'), 'Imagen copiada.')
          : copyImage(await stickerImage('base64'), 'Sticker copiado. Pégalo en tu historia.'),
      SHARE_FAILED,
    )

  // The system picker needs no permission: it hands back only the picture chosen.
  const pick = () =>
    run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] })
      const chosen = result.canceled ? undefined : result.assets[0]?.uri
      if (!chosen) return undefined
      setPicked(chosen)
      // A sticker is previewed over the picture wherever it is; a card has its own place.
      if (mode === 'sticker') return undefined
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

  const actions: readonly ShareAction[] =
    mode === 'image'
      ? [
          { label: 'Fondo', icon: 'image', onPress: background },
          { label: 'Historias', icon: 'instagram', onPress: story },
          { label: 'Guardar', icon: 'download', onPress: save },
          { label: 'Copiar', icon: 'duplicate', onPress: copy },
          { label: 'Más', icon: 'more', onPress: share },
        ]
      : [
          { label: 'Copiar', icon: 'duplicate', onPress: copy, primary: true },
          { label: 'Guardar', icon: 'download', onPress: save },
          { label: 'Historias', icon: 'instagram', onPress: story },
          { label: 'Más', icon: 'more', onPress: share },
        ]
  const previewScale = (kind: keyof typeof SESSION_STICKER_SIZE) =>
    Math.min(1.15, PREVIEW_WIDTH / SESSION_STICKER_SIZE[kind].width)

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

      <SegmentedControl
        size="sm"
        items={[
          { value: 'image', label: 'Imagen' },
          { value: 'sticker', label: 'Sticker' },
        ]}
        value={mode}
        onChange={switchTo}
        accessibilityLabel="Compartir como"
        style={styles.switch}
        testID="share-mode"
      />

      <Animated.ScrollView
        key={mode}
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
        {mode === 'image'
          ? kinds.map((kind) => (
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
            ))
          : stickers.map((kind) => (
              <View key={kind} accessible accessibilityLabel={`Sticker ${kind}`}>
                <Scaled scale={scale}>
                  <View style={styles.preview}>
                    <Image
                      source={photo ?? sample}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                    <View style={styles.previewSticker}>
                      <SessionSticker
                        kind={kind}
                        summary={summary}
                        catalogue={catalogue}
                        timeZone={timeZone}
                        scale={previewScale(kind)}
                      />
                    </View>
                  </View>
                </Scaled>
              </View>
            ))}
      </Animated.ScrollView>

      {mode === 'sticker' ? (
        <Chip
          label={picked ? 'Vista sobre tu foto · Cambiar' : 'Vista sobre una foto · Cambiar'}
          icon="image"
          selected={false}
          onPress={pick}
          style={styles.photoChip}
          testID="share-photo"
        />
      ) : null}

      <PageDots
        count={mode === 'image' ? kinds.length : stickers.length}
        active={page}
        at={at}
        accessibilityLabel={mode === 'image' ? 'Tarjetas' : 'Stickers'}
        reduceMotion={reduceMotion}
        style={styles.dots}
      />

      <ShareActionRow actions={actions} busy={busy} />

      {mode === 'sticker' ? (
        <Text role="body" size="xs" color="muted" align="center" style={styles.help}>
          {STICKER_HELP}
        </Text>
      ) : null}

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
        onHide={clear}
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
      <View ref={transparent} collapsable={false} pointerEvents="none" style={styles.offscreen}>
        <SessionSticker
          kind={shownSticker}
          summary={summary}
          catalogue={catalogue}
          timeZone={timeZone}
          scale={STICKER_CAPTURE}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 2 },
  switch: { alignSelf: 'center', marginTop: 12 },
  deck: { flexGrow: 0, marginTop: 14 },
  preview: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 24, overflow: 'hidden' },
  previewSticker: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 56,
  },
  photoChip: { alignSelf: 'center', marginTop: 12 },
  help: { paddingHorizontal: 28, marginTop: 10 },
  offscreen: { position: 'absolute', top: 0, left: -CANVAS.width * 4 },
  dots: { alignSelf: 'center', marginTop: 14, marginBottom: 20 },
  toast: { position: 'absolute', alignSelf: 'center' },
  choices: { gap: 12 },
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
