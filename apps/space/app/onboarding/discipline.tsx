/**
 * `06i-1`..`06i-6` — which discipline somebody trains.
 *
 * Asked **before** the goal, because the goal's list is filtered by the answer. The
 * other way round would offer goals the discipline does not pursue, and `HU-SP-010`
 * now says so.
 *
 * **Six cards and one answer.** The five that are not ready are drawn on purpose:
 * knowing what Allfit is going to cover is part of the promise, and a carousel that
 * showed only what exists would say the product is one thing. What keeps that from
 * becoming a false promise is that they cannot be chosen and nothing offers to notify
 * anybody — no interest is recorded, so a notice would promise a message we cannot send.
 *
 * The deck is a paged `ScrollView` rather than a gesture of its own. Paging is what a
 * carousel is, and the platform's own paging brings the rubber-band at the ends and the
 * fling curve; a hand-rolled pan would have to re-earn both.
 *
 * Each card carries its own colour, which is the point of `semanticColor.discipline`:
 * six cards in one accent would say they are the same thing six times.
 */

import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { PageDots } from '@allfitone/react-native/page-dots'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { useAnimatedScrollHandler, useReducedMotion } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import Svg, { Path } from 'react-native-svg'

import { OnboardingHeader } from '../../src/components/onboarding-header'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import {
  DISCIPLINES,
  canSubmitDiscipline,
  disciplineAt,
  indexOfDiscipline,
  sealFor,
  type DisciplineCard,
} from '../../src/client/discipline-form'
import { DISCIPLINE_ART } from '../../src/client/discipline-art'
import { selectionTick } from '../../src/client/selection-tick'
import type { TrainingDiscipline } from '../../src/client/onboarding'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const UNREACHABLE = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

/** Where the screen's own padding ends, so a card fills the width between them. */
const GUTTER = 24

/** The width the illustration is given, top-right, as the canvas lays it out. */
const ART_SIZE = 196

/**
 * And the height it may not exceed. The six drawings are wildly different shapes — the
 * barbell is 229x116, the skipping rope 104x150 — so a square box scales each one by a
 * different rule: the wide ones came out small and the tall ones ran off the card.
 */
const ART_HEIGHT = 158

/**
 * How faint the illustration is. The canvas puts the whole frame at this, which is what
 * makes the drawing sit behind the words rather than beside them.
 */
const ART_OPACITY = 0.28

const TINT: Record<string, keyof ReturnType<typeof useTheme>['color']['discipline']> = {
  strength: 'strength',
  high_intensity: 'highIntensity',
  endurance_cardio: 'endurance',
  combat_sports: 'combat',
  wellbeing_control: 'wellbeing',
  rhythm_classes: 'rhythm',
}

export default function OnboardingDiscipline() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])
  const { width } = useWindowDimensions()
  const deck = useRef<Animated.ScrollView>(null)
  const reduceMotion = useReducedMotion()

  const [shown, setShown] = useState(0)
  // Measured rather than inferred: a paged `ScrollView` stretches its pages to the row,
  // not to itself, so a card sized by the layout could not put its seal on a floor.
  const [deckHeight, setDeckHeight] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        const owed = guardStep('/onboarding/discipline', current)
        if (owed) {
          router.replace(owed)
          return
        }
        // Scrolled as well as recorded: `contentOffset` is applied when the deck mounts
        // and the answer arrives after that, so on its own it would open every return
        // visit on the first card whatever somebody had chosen.
        const answered = indexOfDiscipline(current.answers.training_discipline.value)
        setShown(answered)
        deck.current?.scrollTo({ x: answered * Math.max(1, width), animated: false })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(UNREACHABLE)
      })

    return () => {
      active = false
    }
  }, [flow, router, width])

  const card = disciplineAt(shown)
  const submittable = canSubmitDiscipline({ card, submitting, sessionExpired })
  // The deck is full-bleed, so a page is the whole screen. Paging snaps by the scroll
  // view's own width, and a card narrower than that drifts a gutter further out of
  // register on every page until the next one is showing mid-word.
  const page = Math.max(1, width)

  // Called from the scroll handler's worklet once the deck comes to rest, never per
  // frame: this is the only moment anything has to cross back to React.
  const settle = (landed: number) => {
    if (landed === shown) return
    setShown(landed)
    // One per detent, the same tick the wheels use, fired with the card that lands.
    selectionTick()
  }

  // Nothing is derived from the scroll position any more — only where it comes to rest
  // — but the handler stays a worklet so the settle never rides the JS thread.
  const onScroll = useAnimatedScrollHandler({
    onMomentumEnd: (event) => {
      scheduleOnRN(settle, Math.round(event.contentOffset.x / page))
    },
    // A drag released with no speed left never produces momentum, and without this the
    // card it stopped on would never be the chosen one.
    onEndDrag: (event) => {
      scheduleOnRN(settle, Math.round(event.contentOffset.x / page))
    },
  })

  const submit = async () => {
    if (!submittable) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareTrainingDiscipline(card.code as TrainingDiscipline)
      router.replace(nextRouteAfter('/onboarding/discipline'))
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(UNREACHABLE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const tintOf = (entry: DisciplineCard) => theme.color.discipline[TINT[entry.code] ?? 'strength']

  return (
    <Screen edges={['top', 'bottom']} dots>
      <OnboardingHeader step="/onboarding/discipline" />

      {/* The same header every step of the onboarding wears: `4xl` question, `md` lede.
          The canvas draws this one at 27, which is between two steps of the type scale
          and below what the other seven screens ask with — matching the file here would
          have made this the one screen whose question is a different size, and somebody
          walking through the onboarding reads the sequence, not the frame.

          Rendered once above the deck although the canvas puts it on every card: it is
          the same words on all six, and six copies would slide past each other behind a
          question that never changes. */}
      <View style={styles.heading}>
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          ¿Qué quieres{'\n'}entrenar?
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Elige tu disciplina. Desliza para ver las seis.
        </Text>
      </View>

      <Animated.ScrollView
        ref={deck}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentOffset={{ x: shown * page, y: 0 }}
        style={styles.deck}
        onLayout={(event) => setDeckHeight(event.nativeEvent.layout.height)}
      >
        {DISCIPLINES.map((entry) => (
          <Card
            key={entry.code}
            entry={entry}
            page={page}
            height={deckHeight}
            tint={tintOf(entry)}
          />
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <PageDots
          count={DISCIPLINES.length}
          active={shown}
          color={tintOf(card)}
          accessibilityLabel="Disciplinas"
          reduceMotion={reduceMotion}
          style={styles.dots}
        />
        {failure ? <InlineAlert message={failure} style={styles.alert} /> : null}

        {/* Above the button and in a slot that is always there. Below it, appearing and
            vanishing between cards shoved the button up and down on every swipe — the
            one control on the screen moving under the thumb that is about to press it.
            It promises nothing: no interest is kept, so an offer to notify would be a
            message nobody is going to send. */}
        <View style={styles.notice}>
          {!card.available && !sessionExpired ? (
            <Text role="body" size="xs" color="muted">
              Todavía no puedes elegirla. Estamos construyéndola.
            </Text>
          ) : null}
        </View>

        <Button
          label="Continuar"
          disabled={!submittable}
          loading={submitting}
          onPress={submit}
          style={styles.cta}
        />

        {sessionExpired ? (
          <Button
            label="Iniciar sesión"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
            style={styles.cta}
          />
        ) : null}
      </View>
    </Screen>
  )
}

/**
 * One card, and the two planes it is made of.
 *
 * The words lag the page and the drawing runs ahead, both read off the scroll position
 * on the UI thread — so a swipe moves them without React rendering at all. That
 * separation is what makes the deck read as depth instead of a filmstrip; the card also
 * dims as it leaves, so the one in the window is plainly the one being offered.
 */
function Card({
  entry,
  page,
  height,
  tint,
}: {
  readonly entry: DisciplineCard
  readonly page: number
  readonly height: number
  readonly tint: string
}) {
  const theme = useTheme()
  const borders = theme.color.border.subtle
  const tonal = theme.color.accent.tonal
  const muted = theme.color.background.surfaceMuted

  // −1 when the card is one page to the left, 0 in the window, 1 to the right.

  return (
    <View style={[styles.card, { width: page }, height > 0 && { height }]}>
      {/* Each discipline has its own drawing, which is the point of the deck: one
          figure recoloured six times would say they are the same thing in six colours.
          Pushed right and inert — this card is read, not touched. */}
      <View pointerEvents="none" style={styles.art}>
        {artFor(entry.code, tint)}
      </View>

      <View style={styles.words}>
        <Text role="display" size="6xl" uppercase>
          {entry.title[0]}
        </Text>
        <Text role="display" size="5xl" uppercase style={{ color: tint }}>
          {entry.title[1]}
        </Text>
        <View style={[styles.rule, { backgroundColor: tint }]} />

        <View style={styles.practices}>
          {entry.practices.map((practice, position) => (
            <View key={practice} style={[styles.practice, { borderColor: borders }]}>
              <Text role="label" size="2xs" color="muted">
                {`0${position + 1}`}
              </Text>
              <Text role="display" size="2xl" uppercase style={styles.practiceName}>
                {practice}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.seal,
            {
              backgroundColor: entry.available ? tonal : muted,
            },
          ]}
        >
          <Text role="label" size="2xs" style={{ color: tint }}>
            {sealFor(entry)}
          </Text>
        </View>
      </View>
    </View>
  )
}

function artFor(code: string, tint: string) {
  const art = DISCIPLINE_ART[code]
  // A card with no drawing stands on its words. That is not a placeholder to fill in
  // code: art belongs in the design file, and every card has one there now.
  if (!art) return null

  return (
    // Sized by props rather than by style: `react-native-svg` reads the style for
    // layout but scales the drawing from these, and left off it spills past the card.
    <Svg
      viewBox={art.viewBox}
      width={ART_SIZE}
      height={ART_HEIGHT}
      // Anchored to the top of its box, not centred in it: centring dropped the wide
      // drawings onto the second line of the title, which is a solid word in the accent.
      preserveAspectRatio="xMidYMin meet"
    >
      {art.strokes.map((stroke) => (
        // Outline shapes are filled, centre lines are stroked. Both come out of the
        // design file and they are not interchangeable: filling a centre line paints a
        // blob, and stroking an outline doubles every edge.
        <Path
          key={stroke.d.slice(0, 24)}
          d={stroke.d}
          x={stroke.x}
          y={stroke.y}
          {...(stroke.width === undefined
            ? { fill: tint }
            : {
                fill: 'none',
                stroke: tint,
                strokeWidth: stroke.width,
                strokeLinecap: 'round' as const,
                strokeLinejoin: 'round' as const,
              })}
        />
      ))}
    </Svg>
  )
}

const styles = StyleSheet.create({
  heading: { paddingTop: 2 },
  lede: { marginTop: 9 },
  deck: { flex: 1, marginHorizontal: -GUTTER },
  /*
   * Laid out from the top with the canvas's own gaps, not centred in what is left over.
   * Centring was the reason none of this looked like the design: the card floated in
   * the middle with a void above it and another below, and every gap inside it had been
   * eyeballed at about half what the file says.
   *
   * The numbers below are differences read off `06i-1`, measured between the blocks
   * rather than copied as absolute positions — the type renders at its own metrics here
   * and only the spacing between things is portable.
   */
  card: { paddingHorizontal: GUTTER, paddingTop: 30, paddingBottom: 10, overflow: 'hidden' },
  // Top right, overlapping the title, which is where the canvas hangs it. Flush with the
  // card's top edge: lifted above it, the card's own clip cut the tallest drawings.
  art: { opacity: ART_OPACITY, position: 'absolute', top: 0, right: GUTTER },

  // Full height so the seal can sit on the card's floor. Bienestar lists four practices
  // and the rest three; hung off the list, its seal fell past the bottom and was clipped.
  words: { gap: 0, flex: 1 },
  rule: { width: 132, height: 3, marginTop: 24 },
  practices: { marginTop: 34 },
  practice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 1,
    paddingVertical: 13,
  },
  practiceName: { flex: 1 },
  seal: {
    alignSelf: 'flex-start',
    marginTop: 'auto',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: { paddingTop: 8, paddingBottom: 16, gap: 8 },
  dots: { alignSelf: 'flex-start' },
  swipe: { letterSpacing: 1.4 },
  alert: { marginTop: 8 },
  // A fixed slot, so the button holds still whether the line is there or not.
  notice: { minHeight: 18, justifyContent: 'center' },
  cta: { minHeight: 44, marginTop: 8 },
})
