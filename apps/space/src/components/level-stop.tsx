/**
 * Una parada del recorrido de nivel — `HU-SP-012` criterio 2.
 *
 * Fuera de la ruta por lo mismo que el escenario del objetivo: es lo único de esa
 * pantalla que se puede mirar sin un onboarding a medias, y montada en una ruta de
 * andamio se valida en el simulador.
 *
 * **El hilo no se enciende nunca.** Se probó llenándolo hasta la parada marcada —un
 * nivel contiene a los de abajo— y en pantalla se leía como si la línea se moviera al
 * elegir. Lo único que cambia al marcar es su círculo; la línea está ahí para unir las
 * tres paradas, no para contar nada.
 *
 * Nada cambia de alto. La consecuencia ocupa su sitio siempre y sólo se enciende en la
 * marcada: un cajón que se abre mueve las paradas de abajo bajo el dedo que acaba de
 * tocar, y en un recorrido eso además rompe la línea.
 *
 * **Y nada se encoge al pulsarla.** El resto de la aplicación responde al dedo con un
 * tres por ciento de escala, y aquí no se puede: cada parada es su propio pulsable, así
 * que encogerla encoge **su tramo de la línea** y el carril se parte y vuelve a juntarse
 * al soltar. La respuesta al dedo es una bajada de opacidad, que dice lo mismo y no
 * mueve nada. El ritmo de la línea manda sobre la física del botón.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  type FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { cssDuration, PRESS_DURATION, SPRING } from '../client/motion'
import type { LevelStop } from '../client/experience-form'

/**
 * Lo que tarda el recorrido en llenarse hasta la parada nueva.
 *
 * Tiempo y no muelle para el color: ningún dedo trae velocidad hasta aquí, y un rebote
 * en algo que nadie lanzó se lee como un fallo. La marca sí va con muelle, porque es lo
 * único que se mueve y un salto de tamaño sin peso se ve de plástico.
 */
const SHIFT_MS = 220
const SHIFT_EASE = Easing.bezier(0.23, 1, 0.32, 1)

/** El anillo de la parada marcada, y por tanto el ancho del carril. */
const RING = 28

const PRESS_TRANSITION = {
  transitionProperty: 'opacity',
  transitionDuration: cssDuration(PRESS_DURATION, false),
  transitionTimingFunction: 'ease-out',
} as const

/** Lo que baja al tener el dedo encima. Suficiente para sentirse, sin apagar la fila. */
const PRESS_DIM = 0.6

export function LevelStopRow({
  stop,
  pressable,
  onPress,
  entering,
}: {
  readonly stop: LevelStop
  readonly pressable: boolean
  readonly onPress: () => void
  readonly entering?: FadeInDown
}) {
  const theme = useTheme()
  const [pressing, setPressing] = useState(false)
  const reduceMotion = useReducedMotion()
  const accent = theme.color.border.accent
  const inert = theme.color.border.default
  const { entry, chosen, last } = stop

  const lit = useSharedValue(chosen ? 1 : 0)

  useEffect(() => {
    if (reduceMotion) {
      lit.value = chosen ? 1 : 0
      return
    }
    // Muelle al llenarse y tiempo al vaciarse: lo que llega tiene peso, lo que se va
    // sólo tiene que irse, y un rebote de salida se lee como un rebote de más.
    lit.value = chosen
      ? withSpring(1, SPRING)
      : withTiming(0, { duration: SHIFT_MS, easing: SHIFT_EASE })
  }, [chosen, reduceMotion, lit])

  const markStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(lit.value, [0, 1], [inert, accent]),
    backgroundColor: interpolateColor(lit.value, [0, 1], [theme.color.background.canvas, accent]),
    transform: [{ scale: 1 + 0.15 * lit.value }],
  }))
  const ringStyle = useAnimatedStyle(() => ({ opacity: lit.value }))
  const namingStyle = useAnimatedStyle(() => ({ opacity: lit.value }))
  const outcomeStyle = useAnimatedStyle(() => ({ opacity: lit.value }))

  return (
    <Animated.View style={styles.stopSlot} {...(entering ? { entering } : {})}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: chosen, disabled: !pressable }}
        // La consecuencia es parte de la respuesta, así que quien la oye la oye en la
        // parada que la lleva en vez de sólo verla.
        accessibilityLabel={
          chosen
            ? `${entry.name}. ${entry.description} ${entry.outcome.before}${entry.outcome.emphasis}${entry.outcome.after}`
            : `${entry.name}. ${entry.description}`
        }
        disabled={!pressable}
        onPress={onPress}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
        hitSlop={4}
        pressRetentionOffset={16}
        style={[styles.stop, PRESS_TRANSITION, { opacity: pressing ? PRESS_DIM : 1 }]}
      >
        <View style={styles.rail}>
          {/* Nunca el color solo: la marca llena **y** crece, y el estado se anuncia.
              Es `DT-010`, y es lo que hacen los demás pasos. */}
          <Animated.View style={[styles.mark, markStyle]} />
          <Animated.View
            style={[styles.ring, { borderColor: theme.color.accent.tonalBorder }, ringStyle]}
          />
          {last ? null : <View style={[styles.thread, { backgroundColor: inert }]} />}
        </View>

        <View style={styles.stopText}>
          {/* Dos copias del nombre, una encima de otra y en el mismo sitio: `Text` del
              sistema de diseño no tiene referencia que animar, así que el color no se
              interpola — se cruza. */}
          <View>
            <Text role="display" size="2xl" uppercase color="secondary">
              {entry.name}
            </Text>
            <Animated.View style={[styles.naming, namingStyle]} pointerEvents="none">
              <Text role="display" size="2xl" uppercase>
                {entry.name}
              </Text>
            </Animated.View>
          </View>
          <Text role="body" size="sm" color="secondary" style={styles.detail}>
            {entry.description}
          </Text>
          {/* **Montada siempre, encendida sólo en la marcada.** Antes se montaba al
              elegir, y como las tres paradas se reparten el alto, aparecer le cambiaba
              el alto a una: las marcas y los hilos de las otras dos se movían de sitio.
              Ocupar su hueco desde el principio es lo que deja el recorrido quieto. */}
          <Animated.View
            style={outcomeStyle}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text role="body" size="sm" color="accent" style={styles.consequence}>
              {entry.outcome.before}
              {entry.outcome.emphasis}
              {entry.outcome.after}
            </Text>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Reparte el sobrante entre las tres, que es lo que hace que el recorrido llegue de
  // arriba abajo en vez de amontonarse bajo el título con media pantalla vacía.
  //
  // **`flexBasis: 'auto'` y no `flex: 1`.** Con base cero las tres valen un tercio
  // pase lo que pase, y en un aparato bajo el texto de una parada no cabía en su
  // tercio: la consecuencia se metía encima del nombre de la siguiente. Partiendo de
  // lo que cada una mide, el sobrante se reparte y lo que no cabe hace crecer la
  // pantalla, que para eso se desplaza.
  stopSlot: { flexGrow: 1, flexBasis: 'auto' },
  // Se estira con la ranura: sin esto el pulsable se quedaba con el alto de su texto
  // y el hilo terminaba a media altura.
  stop: { flexGrow: 1, flexDirection: 'row', gap: 16, alignItems: 'stretch' },
  // La columna del recorrido. **Tan ancha como el anillo**, no como la marca: con
  // dieciséis el anillo sobresalía cuatro puntos por la izquierda y el `ScrollView`
  // se los comía, así que la selección salía con un lado plano.
  rail: { width: RING, alignItems: 'center' },
  mark: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, marginTop: 6 },
  // El anillo de la marcada, fuera del flujo para que no desplace el hilo. Va del
  // ancho entero del carril, así que no hay nada que centrar a mano ni que recortar.
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 5,
  },
  // Se estira hasta el final de la parada, que es lo que hace continuo el recorrido.
  thread: { width: 2, flex: 1, marginTop: 2 },
  stopText: { flex: 1, paddingBottom: 24 },
  detail: { marginTop: 6 },
  // Encima de la copia apagada y en su mismo sitio, para que el cruce no derive.
  naming: { position: 'absolute', left: 0, top: 0 },
  consequence: { marginTop: 9 },
})
