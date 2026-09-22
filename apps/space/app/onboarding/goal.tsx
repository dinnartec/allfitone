/**
 * What do you want to achieve — HU-SP-010.
 *
 * **Un escenario que espera, y una lista que no se mueve.** Antes la fila elegida se
 * convertía en tarjeta en su propio sitio: no reordenaba nada, pero cada toque cambiaba
 * el alto de una fila y empujaba las de abajo, así que lo que acababas de tocar se iba
 * de debajo del dedo. Ahora el escenario está arriba desde el primer fotograma —con la
 * figura neutra, sin cian y con una frase que dice qué va a pasar— y elegir sólo cambia
 * lo que hay dentro de él. Las cinco filas se quedan donde están.
 *
 * **La figura neutra es la de «Mantenerme».** No es una casualidad ni un atajo: el
 * cuerpo que no cambia es exactamente lo que ese objetivo promete, así que la misma
 * pieza sirve de cuerpo sin objetivo. Es también lo que hace el lienzo aprobado, y
 * evita una figura más que habría que mantener por sexo declarado.
 *
 * Photographs rather than illustration, because the goal is about a body and the
 * app's identity is already photographic. Which body depends on what was declared
 * one screen earlier — female brings the woman, male and declining bring the man,
 * decided in `bodyVariant` and explained there.
 *
 * Only `maintain` ships a single figure. It is the one goal with no "after": the
 * point of it is that the body stays as it is, and a pair would promise a change
 * the goal explicitly does not make.
 *
 * El alto del escenario sale de la pantalla y no de una proporción: ceder alto en un
 * aparato bajo es mejor que empujar el botón fuera. La aritmética vive en `goal-form.ts`.
 *
 * Nothing arrives preselected. A default here would be an opinion about someone's
 * training dressed as a convenience, and the person has to actually choose.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { Easing, FadeInDown, useReducedMotion } from 'react-native-reanimated'

import { OnboardingHeader } from '../../src/components/onboarding-header'
import {
  durationFor,
  easingFor,
  liftFor,
  shouldPlayEntrance,
  staggerDelays,
} from '../../src/client/motion'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import { goalsFor } from '../../src/client/discipline-form'
import type { TrainingDiscipline } from '../../src/client/onboarding'
import {
  bodyVariant,
  canSubmitGoal,
  CARD_GAP,
  stageHeight,
  TRAINING_GOALS,
  type TrainingGoal,
} from '../../src/client/goal-form'
import { GoalRow, GoalStage } from '../../src/components/goal-stage'

import loseWeightMaleBefore from '../../assets/images/goal/goal-lose-weight-male-before.webp'
import loseWeightMaleAfter from '../../assets/images/goal/goal-lose-weight-male-after.webp'
import loseWeightFemaleBefore from '../../assets/images/goal/goal-lose-weight-female-before.webp'
import loseWeightFemaleAfter from '../../assets/images/goal/goal-lose-weight-female-after.webp'
import buildMuscleMaleBefore from '../../assets/images/goal/goal-build-muscle-male-before.webp'
import buildMuscleMaleAfter from '../../assets/images/goal/goal-build-muscle-male-after.webp'
import buildMuscleFemaleBefore from '../../assets/images/goal/goal-build-muscle-female-before.webp'
import buildMuscleFemaleAfter from '../../assets/images/goal/goal-build-muscle-female-after.webp'
import getFitMaleBefore from '../../assets/images/goal/goal-get-fit-male-before.webp'
import getFitMaleAfter from '../../assets/images/goal/goal-get-fit-male-after.webp'
import getFitFemaleBefore from '../../assets/images/goal/goal-get-fit-female-before.webp'
import getFitFemaleAfter from '../../assets/images/goal/goal-get-fit-female-after.webp'
import runARaceMaleBefore from '../../assets/images/goal/goal-run-a-race-male-before.webp'
import runARaceMaleAfter from '../../assets/images/goal/goal-run-a-race-male-after.webp'
import runARaceFemaleBefore from '../../assets/images/goal/goal-run-a-race-female-before.webp'
import runARaceFemaleAfter from '../../assets/images/goal/goal-run-a-race-female-after.webp'
import maintainMaleSingle from '../../assets/images/goal/goal-maintain-male-single.webp'
import maintainFemaleSingle from '../../assets/images/goal/goal-maintain-female-single.webp'

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const UNREACHABLE = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

/**
 * Copy and artwork per goal. The icon names come from the design system, whose
 * catalogue owns what an icon means; the app never decides that.
 */
const GOALS: Record<
  TrainingGoal,
  {
    name: string
    why: string
    icon: 'weight' | 'training' | 'activity' | 'race' | 'heart'
    male: { before: number; after: number | null }
    female: { before: number; after: number | null }
  }
> = {
  lose_weight: {
    name: 'Bajar de peso',
    why: 'Reduce grasa corporal y mejora tu composición.',
    icon: 'weight',
    male: { before: loseWeightMaleBefore, after: loseWeightMaleAfter },
    female: { before: loseWeightFemaleBefore, after: loseWeightFemaleAfter },
  },
  build_muscle: {
    name: 'Construir músculo',
    why: 'Aumenta tu masa muscular y tu fuerza.',
    icon: 'training',
    male: { before: buildMuscleMaleBefore, after: buildMuscleMaleAfter },
    female: { before: buildMuscleFemaleBefore, after: buildMuscleFemaleAfter },
  },
  get_fit: {
    name: 'Ponerme en forma',
    why: 'Mejora tu condición física y energía diaria.',
    icon: 'activity',
    male: { before: getFitMaleBefore, after: getFitMaleAfter },
    female: { before: getFitFemaleBefore, after: getFitFemaleAfter },
  },
  run_a_race: {
    name: 'Correr una carrera',
    why: 'Prepárate para completar tu próxima carrera.',
    icon: 'race',
    male: { before: runARaceMaleBefore, after: runARaceMaleAfter },
    female: { before: runARaceFemaleBefore, after: runARaceFemaleAfter },
  },
  maintain: {
    name: 'Mantenerme',
    why: 'Mantén tu estado actual y hábitos saludables.',
    icon: 'heart',
    male: { before: maintainMaleSingle, after: null },
    female: { before: maintainFemaleSingle, after: null },
  },
}

export default function OnboardingTrainingGoal() {
  const router = useRouter()
  const { height } = useWindowDimensions()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [rowWidth, setRowWidth] = useState(0)
  const [goal, setGoal] = useState<TrainingGoal | undefined>(undefined)
  const [discipline, setDiscipline] = useState<TrainingDiscipline | null>(null)
  const [declaredSex, setDeclaredSex] = useState<'male' | 'female' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const reduceMotion = useReducedMotion()
  const [entering, setEntering] = useState(false)

  // The discipline decides which goals exist here — with strength there is no point
  // offering a race — and that is why it is asked one step earlier.
  const offered = useMemo(() => goalsFor(discipline, TRAINING_GOALS), [discipline])

  /**
   * Las figuras de todos los objetivos que se ofrecen, para que el escenario las tenga
   * montadas antes de que alguien elija. Sustituye a la precarga invisible que había
   * aquí: decodificaba lo mismo y no servía, porque al cambiar se montaba otra copia.
   */
  const gallery = useMemo(
    () =>
      offered.map((option) => ({
        key: option,
        bodies: GOALS[option][bodyVariant(declaredSex, option)],
      })),
    [offered, declaredSex],
  )

  // Built outside the JSX: an inline chain rebuilds the builder on every render,
  // and a per-index delay cannot live at module scope.
  const entrances = useMemo(() => {
    const delays = staggerDelays(TRAINING_GOALS.length + 2, reduceMotion)
    return delays.map((delay) =>
      FadeInDown.duration(durationFor('fast', reduceMotion))
        .delay(delay)
        .easing(Easing.bezier(...easingFor('emphasized')).factory())
        .withInitialValues({ transform: [{ translateY: liftFor(reduceMotion) }] }),
    )
  }, [reduceMotion])

  const stage = { width: Math.max(0, rowWidth), height: stageHeight(height) }

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable, which is what the back arrow is for.
        const owed = guardStep('/onboarding/goal', current)
        if (owed) {
          router.replace(owed)
          return
        }
        setDeclaredSex(current.answers.biological_sex.value ?? null)
        setDiscipline(current.answers.training_discipline.value ?? null)
        const declared = current.answers.primary_training_goal.value
        if (declared) setGoal(declared)

        setEntering(shouldPlayEntrance(Boolean(declared)))
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
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable = canSubmitGoal({ goal, submitting, sessionExpired })

  const submit = async () => {
    if (goal === undefined) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareTrainingGoal(goal)
      router.replace(nextRouteAfter('/onboarding/goal'))
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

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />
      <OnboardingHeader step="/onboarding/goal" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View {...(entering && entrances[0] ? { entering: entrances[0] } : {})}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            ¿Qué quieres{'\n'}lograr?
          </Text>
          <Text role="body" size="md" color="secondary" style={styles.lede}>
            Elige uno. Es la dirección que toma tu entrenamiento, y puedes cambiarlo cuando quieras.
          </Text>
        </Animated.View>

        <View onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
          <Animated.View {...(entering && entrances[1] ? { entering: entrances[1] } : {})}>
            <GoalStage
              width={stage.width}
              height={stage.height}
              entry={goal ? GOALS[goal] : undefined}
              showing={goal}
              gallery={gallery}
              neutral={GOALS.maintain[bodyVariant(declaredSex, 'maintain')].before}
              reduceMotion={reduceMotion}
            />
          </Animated.View>

          {/* Las cinco se quedan donde están. La elegida no sube a ninguna parte:
              lo que cambia al tocar es el escenario, no la lista que se está
              leyendo con el dedo encima. */}
          <View style={styles.list}>
            {offered.map((option, index) => (
              <GoalRow
                key={option}
                name={GOALS[option].name}
                why={GOALS[option].why}
                chosen={option === goal}
                first={index === 0}
                pressable={pressable}
                onPress={() => setGoal(option)}
                {...(entering && entrances[index + 2] ? { entering: entrances[index + 2] } : {})}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Outside the scroll: expanding a row grows the list, and with the
          button inside it slid down on every selection, which read as the
          whole screen lurching. */}
      <View style={styles.footer}>
        {failure ? <InlineAlert message={failure} style={styles.alert} /> : null}

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
            style={styles.signIn}
          />
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  lede: { marginTop: 9, marginBottom: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 4 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  list: { marginTop: CARD_GAP },
  alert: { marginTop: 12 },
  cta: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
