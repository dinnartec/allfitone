/**
 * «Comparte tu semana» and «Comparte tu mes» (PROG-SH6a, PROG-SH6b): the period on
 * «Progreso», for the programme chosen there, as cards and as stickers.
 *
 * **Imagen or Sticker, chosen at the top.** An image is a whole card on its own dark
 * ground, as «Compártelo» makes them. A sticker is the figures alone on nothing, to go
 * over a photograph of the person's own; the carousel shows each one over a sample
 * photograph, which «Cambiar foto» swaps for one from the gallery. That photograph is
 * only a preview: it is never part of the sticker, never uploaded, and gone when the
 * screen closes. The last mode used is remembered on the phone.
 *
 * **What is shared is captured apart from what is shown**, for the reason
 * «Compártelo» gives: a card is redrawn off screen on a story's canvas, a sticker at
 * twice its size on a transparent ground, so the PNG keeps its transparency. Twice
 * means drawn at twice, never scaled up: iOS rasterises text first, and an enlarged
 * sticker came out with every letter soft.
 *
 * **The receipt needs the sessions**, which the comparison does not carry, so the
 * history is read for the week. It lists every session, not one programme's, so the
 * receipt is offered only for everything or for free training.
 */

import { Chip } from '@allfitone/react-native/chip'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { PageDots } from '@allfitone/react-native/page-dots'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { Toast } from '@allfitone/react-native/toast'
import { useTheme } from '@allfitone/react-native/theme'
import { color } from '@allfitone/react-native/tokens'
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

import sample from '../../assets/images/today/today-hero.webp'
import type { MuscleTerm } from '../../src/client/content'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { periodLabel, type PeriodComparison, type PeriodKind } from '../../src/client/progress'
import {
  cardsFor,
  receiptRows,
  shareFacts,
  stickersFor,
  type ReceiptRow,
} from '../../src/client/progress-share'
import { comparePeriods } from '../../src/client/progress-transport'
import { cardScale } from '../../src/client/share-cards'
import { deviceTimezone } from '../../src/client/timezone'
import { ProgressCard } from '../../src/components/progress-share-card'
import { ProgressSticker, STICKER_SIZE } from '../../src/components/progress-stickers'
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
} from '../../src/components/share-actions'
import { CARD_HEIGHT, CARD_WIDTH, Scaled } from '../../src/components/share-card'

/** The same six periods «Progreso» reads, so a load's trend has the same shape. */
const PERIODS = 6
const GAP = 27
/** Header, the switch, dots, the actions and the help: what the card shares the screen with. */
const CHROME = 360
const CANVAS = { width: 360, height: 640 } as const
const CAPTURE_SCALE = (CANVAS.width * 0.8) / CARD_WIDTH
const STORY = { width: 1080, height: 1920 } as const
const STORY_INKS = { top: '#0D1D28', bottom: color.ink.void } as const
/** A sticker is drawn at twice its box for the capture, natively: enlarging blurs it. */
const STICKER_CAPTURE = 2
/** The width a sticker takes over the preview photograph. */
const PREVIEW_WIDTH = 260

const LOAD_FAILED = 'No pudimos preparar tus tarjetas. Inténtalo otra vez.'
const STICKER_HELP =
  'Copia el sticker y pégalo sobre tu foto en Instagram, o guárdalo sin fondo en tu galería.'

/** Every session of the week, read from the history of the month or two it spans. */
async function weekSessions(startsOn: string, timezone: string, free: boolean) {
  const months = [...new Set([startsOn.slice(0, 7), plusSix(startsOn).slice(0, 7)])]
  const flow = createSpaceExecutionFlow()
  const pages = await Promise.all(
    months.map((month) =>
      flow.listHistory({ timezone, month: `${month}-01`, limit: 50, ...(free ? { free } : {}) }),
    ),
  )
  return pages.flatMap((page) => page.data)
}

function plusSix(iso: string): string {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 6)).toISOString().slice(0, 10)
}

export default function ShareProgressScreen() {
  const params = useLocalSearchParams<{ kind?: string; offset?: string; program?: string }>()
  const kind: PeriodKind = params.kind === 'month' ? 'month' : 'week'
  const offset = Number(params.offset ?? '0') || 0
  const program = params.program ? params.program : null
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion()
  const { width, height } = useWindowDimensions()
  const timezone = deviceTimezone()

  const [comparison, setComparison] = useState<PeriodComparison | undefined>(undefined)
  const [muscles, setMuscles] = useState<readonly MuscleTerm[]>([])
  const [receipt, setReceipt] = useState<readonly ReceiptRow[]>([])
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useShareMode()
  const [page, setPage] = useState(0)
  /** A photograph from the gallery to preview stickers on, held only while open. */
  const [picked, setPicked] = useState<string | null>(null)
  const { busy, notice, clear, run } = useShareRun()

  const deck = useRef<Animated.ScrollView>(null)
  const canvas = useRef<View>(null)
  const card = useRef<View>(null)
  const sticker = useRef<View>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      comparePeriods(kind, PERIODS, timezone, program),
      readExerciseLibrary(createSpaceContentFlow()).catch(() => undefined),
    ])
      .then(async ([read, library]) => {
        if (!active) return
        setComparison(read)
        setMuscles(library?.muscles ?? [])
        const index = read.periods.length - 1 - offset
        const startsOn = read.periods[index]?.starts_on
        // The history lists every programme at once: the receipt is not one programme's.
        if (kind !== 'week' || !startsOn || (program !== null && program !== 'free')) return
        const items = await weekSessions(startsOn, timezone, program === 'free').catch(() => [])
        if (active && items.length > 0) setReceipt(receiptRows(items, startsOn))
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [kind, offset, program, timezone])

  const index = comparison ? comparison.periods.length - 1 - offset : -1
  const facts = comparison && index >= 0 ? shareFacts(comparison, index) : undefined
  const cards = facts ? cardsFor(facts, receipt.length > 0) : []
  const stickers = facts ? stickersFor(facts) : []
  const count = mode === 'image' ? cards.length : stickers.length

  const scale = cardScale(width, height - insets.top - insets.bottom - CHROME)
  const cardWidth = CARD_WIDTH * scale
  const interval = cardWidth + GAP

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
  const shownCard = cards[Math.min(page, cards.length - 1)] ?? 'load'
  const shownSticker = stickers[Math.min(page, stickers.length - 1)] ?? 'figures'

  const switchTo = (next: ShareMode) => {
    setMode(next)
    setPage(0)
    at.set(0)
    deck.current?.scrollTo({ x: 0, animated: false })
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/progress'))

  const title = kind === 'week' ? 'Comparte tu semana' : 'Comparte tu mes'
  const chosen =
    program === null
      ? null
      : program === 'free'
        ? 'Libres'
        : (comparison?.programs.find((one) => one.assignment_id === program)?.title ?? null)
  const startsOn = comparison?.periods[index]?.starts_on
  const subtitle = [startsOn ? periodLabel(startsOn, kind) : null, chosen]
    .filter((part): part is string => part !== null)
    .join(' · ')

  /** The card in view on a story's canvas, as «Compártelo» captures it. */
  const image = (result: 'tmpfile' | 'base64') =>
    captureRef(canvas, {
      format: 'png',
      quality: 1,
      result,
      width: STORY.width / PixelRatio.get(),
      height: STORY.height / PixelRatio.get(),
    })

  const stickerImage = (result: 'tmpfile' | 'base64') =>
    captureRef(sticker, { format: 'png', quality: 1, result })

  const sheet = async () =>
    shareFile(await (mode === 'image' ? image('tmpfile') : stickerImage('tmpfile')), title)

  const story = () =>
    run(async () => {
      const png =
        mode === 'image'
          ? await captureRef(card, { format: 'png', quality: 1, result: 'base64' })
          : await stickerImage('base64')
      const background = mode === 'sticker' ? (picked ?? undefined) : undefined
      return (await openStory({ sticker: png, inks: STORY_INKS, background })) ? undefined : sheet()
    }, SHARE_FAILED)

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
      const uri = result.canceled ? undefined : result.assets[0]?.uri
      if (uri) setPicked(uri)
      return undefined
    }, SHARE_FAILED)

  if (failed || !facts) {
    return (
      <Screen edges={['top', 'bottom']} padded={false}>
        <View style={styles.header}>
          <IconButton icon="close" accessibilityLabel="Cerrar" onPress={close} />
        </View>
        <View style={styles.waiting}>
          {failed ? (
            <InlineAlert message={LOAD_FAILED} />
          ) : (
            <ActivityIndicator color={theme.color.icon.accent} />
          )}
        </View>
      </Screen>
    )
  }

  const actions: readonly ShareAction[] =
    mode === 'image'
      ? [
          { label: 'Historias', icon: 'instagram', onPress: story },
          { label: 'Guardar', icon: 'download', onPress: save },
          { label: 'Copiar', icon: 'duplicate', onPress: copy },
          { label: 'Más', icon: 'more', onPress: () => run(sheet, SHARE_FAILED) },
        ]
      : [
          { label: 'Copiar', icon: 'duplicate', onPress: copy, primary: true },
          { label: 'Guardar', icon: 'download', onPress: save },
          { label: 'Historias', icon: 'instagram', onPress: story },
          { label: 'Más', icon: 'more', onPress: () => run(sheet, SHARE_FAILED) },
        ]

  const previewScale = (kindOf: keyof typeof STICKER_SIZE) =>
    Math.min(1.15, PREVIEW_WIDTH / STICKER_SIZE[kindOf].width)

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Cerrar" onPress={close} />
        <View style={styles.titles}>
          <Text role="control" size="lg" align="center" accessibilityRole="header">
            {title}
          </Text>
          <Text role="body" size="sm" color="muted" align="center" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.side} />
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
          ? cards.map((kindOf) => (
              <View key={kindOf} accessible accessibilityLabel={`Tarjeta ${kindOf}`}>
                <Scaled scale={scale}>
                  <ProgressCard kind={kindOf} facts={facts} receipt={receipt} muscles={muscles} />
                </Scaled>
              </View>
            ))
          : stickers.map((kindOf) => (
              <View key={kindOf} accessible accessibilityLabel={`Sticker ${kindOf}`}>
                <Scaled scale={scale}>
                  <View style={styles.preview}>
                    <Image
                      source={picked ?? sample}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                    <View style={styles.previewSticker}>
                      <ProgressSticker
                        kind={kindOf}
                        facts={facts}
                        muscles={muscles}
                        scale={previewScale(kindOf)}
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
        count={count}
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

      <Toast
        message={notice?.text}
        tone={notice?.tone === 'failed' ? 'danger' : 'success'}
        reduceMotion={reduceMotion}
        onHide={clear}
        style={[styles.toast, { bottom: insets.bottom + 150 }]}
        testID="share-toast"
      />

      {/* What is captured: off screen, a card on the story's canvas or a sticker on nothing. */}
      <View ref={canvas} collapsable={false} style={styles.canvas} pointerEvents="none">
        <View ref={card} collapsable={false}>
          <Scaled scale={CAPTURE_SCALE}>
            <ProgressCard kind={shownCard} facts={facts} receipt={receipt} muscles={muscles} />
          </Scaled>
        </View>
      </View>
      <View ref={sticker} collapsable={false} pointerEvents="none" style={styles.offscreen}>
        <ProgressSticker
          kind={shownSticker}
          facts={facts}
          muscles={muscles}
          scale={STICKER_CAPTURE}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  titles: { flex: 1, gap: 2 },
  side: { width: 44 },
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
  dots: { alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  help: { paddingHorizontal: 28, marginTop: 12 },
  toast: { position: 'absolute', alignSelf: 'center' },
  canvas: {
    position: 'absolute',
    top: 0,
    left: -CANVAS.width * 2,
    width: CANVAS.width,
    height: CANVAS.height,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ink.void,
  },
  offscreen: { position: 'absolute', top: 0, left: -CANVAS.width * 4 },
})
