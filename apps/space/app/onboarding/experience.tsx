/**
 * How much have you trained — HU-SP-012, criterion 2.
 *
 * **Una sola escala, de pie.** Tres paradas en un recorrido vertical, de menos a más.
 * Antes eran tres tarjetas con una barra de rango en cada una, y tres escalas dibujadas
 * una dentro de otra dicen peor lo que una sola dice entera.
 *
 * **La línea no se llena.** Se probó llenándola hasta la parada marcada —un nivel
 * contiene a los de abajo— y se leía como si la línea se moviera al elegir, que es lo
 * que una lista de opciones no puede hacer. Lo único que cambia al marcar es su círculo.
 *
 * Las palabras siguen sin llevar rango. `HU-SP-012` pide términos simples y la razón es
 * de comportamiento y no de estilo: «avanzado» hace que la gente se subestime, elija por
 * debajo y acabe con un plan que la aburre. La escala se dibuja y no se nombra, y ahora
 * se dibuja mejor.
 *
 * **La parada marcada dice qué cambia en el plan.** Una que sólo se encienda obliga a
 * adivinar qué se está eligiendo; nombrar la consecuencia es lo que deja contestar con
 * honestidad en vez de con modestia, que es el sentido entero de la pregunta.
 *
 * La consecuencia **no se despliega**: está en su sitio desde el principio y sólo
 * aparece la de la parada marcada. Nada cambia de alto al tocar, así que la lista no se
 * mueve bajo el dedo — que es lo que costaba el cajón animado que había aquí.
 *
 * El aviso de debajo es **fijo, no revelado**. Quien teme que lo etiqueten tiene que
 * leer que las cargas se mueven desde la primera semana **antes** de contestar;
 * enseñarlo después es enseñarlo cuando ya no le sirve para elegir.
 *
 * Re-tapping the chosen level leaves it chosen. "No level" is not an answer this
 * question offers — unlike the biological sex, where declining means something. But
 * nothing arrives selected either: a default would write a declaration nobody made.
 *
 * One global level, not one per discipline. The criterion read "in each one", and
 * that was amended: the discipline catalogue holds no production rows and is not
 * readable by the runtime role at all, so there is nothing to hang a per-discipline
 * level on. Were it to become readable, that is a new attribute rather than a wider
 * version of this one.
 *
 * The consequence copy is **not validated**. "Medium volume" and "progressions from
 * the first week" describe what the plan will do, and nothing consumes an experience
 * level today, so they state an intention. Recorded as pending confirmation in
 * `allfitone-docs`; the alternative was to let it look settled because it is written
 * in code.
 */

import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
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
import {
  canSubmitExperience,
  chooseLevel,
  EXPERIENCE_LEVELS,
  experienceStops,
  NOT_A_LABEL_BODY,
  NOT_A_LABEL_TITLE,
  PICK_A_LEVEL,
  readLevel,
  type TrainingExperience,
} from '../../src/client/experience-form'
import { LevelStopRow } from '../../src/components/level-stop'

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const READ_FAILED = 'No pudimos leer tus respuestas. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

export default function OnboardingExperience() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const theme = useTheme()
  const [level, setLevel] = useState<TrainingExperience | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [entering, setEntering] = useState(false)
  const reduceMotion = useReducedMotion()

  // Built outside the JSX: an inline chain rebuilds the builder on every render,
  // and a per-index delay cannot live at module scope.
  const entrances = useMemo(() => {
    const delays = staggerDelays(EXPERIENCE_LEVELS.length + 2, reduceMotion)
    return delays.map((delay) =>
      FadeInDown.duration(durationFor('fast', reduceMotion))
        .delay(delay)
        .easing(Easing.bezier(...easingFor('emphasized')).factory())
        .withInitialValues({ transform: [{ translateY: liftFor(reduceMotion) }] }),
    )
  }, [reduceMotion])

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable, which is what the back arrow is for.
        const owed = guardStep('/onboarding/experience', current)
        if (owed) {
          router.replace(owed)
          return
        }
        const declared = readLevel(current.answers.training_experience.value)
        if (declared) setLevel(declared)

        setEntering(shouldPlayEntrance(Boolean(declared)))
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(READ_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable = canSubmitExperience({ level, submitting, sessionExpired })

  const submit = async () => {
    if (level === undefined) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareTrainingExperience(level)
      router.replace(nextRouteAfter('/onboarding/experience'))
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(SAVE_FAILED)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']} dots>
      <OnboardingHeader step="/onboarding/experience" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View {...(entering && entrances[0] ? { entering: entrances[0] } : {})}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            ¿Cuánto has{'\n'}entrenado?
          </Text>
          <Text role="body" size="md" color="secondary" style={styles.lede}>
            {PICK_A_LEVEL}
          </Text>
        </Animated.View>

        {/* El recorrido entero, frío, desde el primer fotograma. Si apareciera al
            elegir, la escala sólo la vería quien ya decidió. */}
        <View style={styles.track}>
          {experienceStops(level).map((stop, index) => (
            <LevelStopRow
              key={stop.entry.level}
              stop={stop}
              pressable={pressable}
              onPress={() => setLevel((current) => chooseLevel(current, stop.entry.level))}
              {...(entering && entrances[index + 1] ? { entering: entrances[index + 1] } : {})}
            />
          ))}
        </View>

        {/* Fixed rather than revealed: it is what someone worried about being
            labelled needs before answering, not after. Con filete a la izquierda: deja
            de ser letra pequeña al pie y pasa a ser una frase sostenida por algo, que
            es lo que hace que se lea antes de contestar y no después. */}
        <Animated.View
          {...(entering && entrances[EXPERIENCE_LEVELS.length + 1]
            ? { entering: entrances[EXPERIENCE_LEVELS.length + 1] }
            : {})}
          style={[styles.notice, { borderLeftColor: theme.color.accent.tonalBorder }]}
        >
          <Text role="body" size="xs" color="muted">
            <Text role="body" size="xs" color="secondary">
              {NOT_A_LABEL_TITLE}
            </Text>
            {NOT_A_LABEL_BODY}
          </Text>
        </Animated.View>
      </ScrollView>

      {/* Outside the scroll so the button sits in the same place on every step of
          the onboarding, whatever the content above it does. */}
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
  scroll: { flex: 1 },
  // Crece para llenar la pantalla cuando el contenido es corto, y se desplaza
  // cuando el texto del sistema lo estira. Sin esto el recorrido no se reparte.
  scrollContent: { paddingBottom: 4, flexGrow: 1 },
  lede: { marginTop: 9, marginBottom: 18 },
  // Crece con lo que lleva dentro, y no al revés: ver `stopSlot` en `level-stop`.
  track: { flexGrow: 1, marginBottom: 4 },
  notice: {
    marginTop: 2,
    paddingLeft: 12,
    borderLeftWidth: 2,
  },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  alert: { marginTop: 12 },
  cta: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
