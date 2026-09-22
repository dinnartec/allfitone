/**
 * El escenario del objetivo y las filas que lo alimentan — `HU-SP-010`.
 *
 * Fuera de la ruta porque la ruta ya pesaba seiscientas líneas y porque esto es lo
 * único de esa pantalla que se puede mirar sin sesión: montado en una ruta de andamio
 * se valida en el simulador, que es la regla, y la pantalla de verdad exige un
 * onboarding a medias que no se puede fabricar desde aquí.
 *
 * **El escenario es la misma caja vacía y elegida.** Vacía lleva la figura neutra, el
 * halo apagado y una frase que dice qué va a pasar; elegida, el antes y el después del
 * objetivo con su nombre. Un escenario que apareciera al primer toque haría saltar la
 * lista entera justo cuando alguien acaba de tocarla.
 *
 * Nada se desmonta: las dos caras viven a la vez y se cruzan por opacidad, porque
 * `Text` del sistema de diseño no tiene referencia que animar en el hilo de la interfaz
 * y montarlas por turnos las hacía parpadear.
 */

import { SignalBlock, Veil } from '@allfitone/react-native/gradient'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect, useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  Extrapolation,
  type FadeInDown,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { cssDuration, PRESS_DURATION, PRESS_SCALE, SPRING } from '../client/motion'
import { pairHeight } from '../client/goal-form'

import halo from '../../assets/images/goal/goal-halo.webp'

/** How far the front figure sits from the card edge, and how much of the one behind
 *  it hides. Both were tuned against the approved prototype. */
const EDGE = 10
const OVERLAP = 0.55

/**
 * How far the glow spreads past the figures. Kept modest and faint: at 1.7 and 40 % it
 * read as a cyan blob beside the bodies rather than as light behind them, and DT-009
 * reserves cyan for action and focus — it never decorates.
 */
const HALO_SCALE = 1.25

/**
 * How far the figures rise into place as the scene lights up. Short: they are arriving
 * inside a box that is already there, and a long throw fights that stillness.
 */
const FIGURE_RISE = 14

/**
 * El valle: lo que tarda en irse lo que había y en llegar lo que viene.
 *
 * Asimétrico a propósito. Irse es más rápido que llegar porque lo que se va ya no
 * interesa a nadie, y los dos juntos caben en el presupuesto de trescientos: por encima
 * el escenario deja de sentirse como una respuesta al dedo.
 */
const FADE_OUT_MS = 130
const FADE_IN_MS = 190
const FADE_EASE = Easing.bezier(0.23, 1, 0.32, 1)

const PRESS_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: cssDuration(PRESS_DURATION, false),
  transitionTimingFunction: 'ease-out',
} as const

/** Lo que el escenario escribe cuando hay un objetivo elegido. */
export interface StageEntry {
  readonly name: string
  readonly why: string
}

/**
 * A height with no width makes React Native fall back to the file's intrinsic width,
 * and the box then spreads left across the whole card — which is exactly how the copy
 * ended up sitting on top of the bodies. The aspect comes from the asset itself rather
 * than a baked constant, so re-exporting the artwork at a different size cannot
 * silently break the layout.
 */
function figureAspect(source: number): number {
  const asset = Image.resolveAssetSource(source)
  if (!asset?.width || !asset?.height) return 0
  return asset.width / asset.height
}

/**
 * El escenario: lo que el objetivo elegido enseña, y lo que enseña mientras no hay uno.
 *
 * **La misma caja en los dos estados.** Vacía no se esconde ni se encoge: lleva la
 * figura neutra, el halo apagado y una frase que dice qué va a pasar al elegir. Un
 * escenario que apareciera al primer toque haría saltar la lista entera justo cuando
 * alguien acaba de tocarla, que es el defecto que esta pantalla tenía.
 *
 * Nada aquí se desmonta: las dos caras —la espera y el objetivo— viven a la vez y se
 * cruzan por opacidad, porque `Text` del sistema de diseño no tiene referencia que
 * animar en el hilo de la interfaz y montarlas por turnos las hacía parpadear.
 *
 * **Y cambiar de un objetivo a otro también es una transición.** Sólo se animaba entrar
 * y salir del vacío: con uno ya elegido, tocar otro cambiaba las figuras y el nombre en
 * un fotograma, que es un corte y no un cambio. Ahora lo que se dibuja es `shown`, un
 * paso por detrás de lo elegido: el escenario baja a cero, cambia de contenido en el
 * fondo del valle —donde no hay nada que ver— y vuelve a subir. Una sola pasada sirve
 * para los dos casos, porque salir del vacío es el mismo movimiento con la figura neutra
 * en el papel de la anterior.
 *
 * **Y las figuras de los cinco están montadas todas a la vez.** Montar sólo las del
 * elegido significaba que al cambiar había que decodificar dos fotografías nuevas, y eso
 * no cabe en el valle: la animación salía a tiempo y la imagen llegaba un par de
 * fotogramas tarde, que es el corte raro que se veía. Montadas desde el principio, el
 * cambio es encender una capa y apagar otra — sin decodificar nada. Cuesta lo mismo que
 * la precarga invisible que la pantalla ya hacía, sólo que ahora es la de verdad.
 */
export function GoalStage({
  width,
  height,
  entry,
  showing,
  gallery,
  neutral,
  reduceMotion,
}: {
  readonly width: number
  readonly height: number
  readonly entry: StageEntry | undefined
  /** Cuál de la galería está elegido, o nada. */
  readonly showing: string | undefined
  /** Las figuras de todos los objetivos que la pantalla ofrece, montadas a la vez. */
  readonly gallery: readonly { key: string; bodies: { before: number; after: number | null } }[]
  /** El cuerpo sin objetivo: el de «Mantenerme», que es el que no cambia. */
  readonly neutral: number
  readonly reduceMotion: boolean
}) {
  const theme = useTheme()

  /**
   * Lo que el escenario está dibujando, que va un paso por detrás de lo elegido.
   *
   * El cambio ocurre en el fondo del valle y no al tocar: cambiarlo al tocar es
   * exactamente el corte que esto viene a quitar.
   */
  const [shown, setShown] = useState(entry)
  const [drawn, setDrawn] = useState(showing)
  // La última intención, para que dos toques rápidos no dejen dibujado el penúltimo.
  const wanted = useRef({ entry, showing })
  wanted.current = { entry, showing }

  const swap = useSharedValue(1)
  const progress = useSharedValue(shown ? 1 : 0)

  useEffect(() => {
    if (entry === shown) return
    if (reduceMotion) {
      setShown(entry)
      setDrawn(showing)
      return
    }
    swap.value = withTiming(0, { duration: FADE_OUT_MS, easing: FADE_EASE }, (finished) => {
      'worklet'
      // Sólo al cruzar el umbral, nunca por fotograma: aquí es donde el contenido
      // cambia, y es el único sitio donde cruzar al hilo de React está justificado.
      if (finished) scheduleOnRN(arrive)
    })
  }, [entry, shown, showing, reduceMotion, swap])

  const arrive = () => {
    setShown(wanted.current.entry)
    setDrawn(wanted.current.showing)
  }

  useEffect(() => {
    if (reduceMotion) {
      swap.value = 1
      progress.value = shown ? 1 : 0
      return
    }
    swap.value = withTiming(1, { duration: FADE_IN_MS, easing: FADE_EASE })
    progress.value = withSpring(shown ? 1 : 0, SPRING)
  }, [shown, reduceMotion, swap, progress])

  const accent = theme.color.border.accent
  const edge = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.color.border.subtle, theme.color.accent.tonalBorder],
    ),
  }))
  // La espera y el objetivo se cruzan con `progress`, que es el estado; el contenido
  // entra y sale con `swap`, que es la transición. Multiplicados, ninguno pisa al otro.
  const waiting = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP) * swap.value,
  }))
  const arrived = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP) * swap.value,
  }))
  const lit = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
  }))
  const rising = useAnimatedStyle(() => ({
    opacity: swap.value,
    transform: [{ translateY: (1 - swap.value) * FIGURE_RISE }],
  }))

  const neutralAspect = figureAspect(neutral)
  const neutralHeight = Math.min(height, (width * 0.34) / (neutralAspect || 1))

  return (
    <SignalBlock variant="surfaceDeep" style={styles.stageFill}>
      <Animated.View style={[styles.stage, { height }, edge]}>
        {/* La figura neutra vive debajo de las del objetivo y se apaga cuando llegan,
            en vez de desmontarse: es la misma caja enseñando otra cosa. */}
        <Animated.View style={[StyleSheet.absoluteFill, waiting]} pointerEvents="none">
          <Halo
            size={neutralHeight}
            height={height}
            right={EDGE * 4}
            tint={theme.color.border.default}
          />
          <Image
            source={neutral}
            style={[
              styles.figure,
              {
                height: neutralHeight,
                width: neutralHeight * neutralAspect,
                right: EDGE * 4,
                top: height - neutralHeight,
              },
            ]}
            resizeMode="cover"
            accessible={false}
          />
        </Animated.View>

        {/* Todas montadas, una encendida. Apagar y encender no decodifica nada, que es
            lo que hace que la imagen llegue a tiempo con la animación. */}
        <Animated.View style={[StyleSheet.absoluteFill, rising]} pointerEvents="none">
          {gallery.map((piece) => (
            <View
              key={piece.key}
              style={[StyleSheet.absoluteFill, { opacity: piece.key === drawn ? 1 : 0 }]}
            >
              <Bodies bodies={piece.bodies} width={width} height={height} tint={accent} />
            </View>
          ))}
        </Animated.View>

        {/* El velo va sobre las figuras y bajo las palabras: una pareja ancha —la de
            correr es un perfil— alcanza la mitad izquierda, y el texto encima de un
            brazo se lee mal aunque el brazo esté a media opacidad. */}
        <Veil edge="left" extent={width * 0.62} hold={0.3} background="surface" />

        {/* Proporcional y no los ciento cincuenta del lienzo: ese número era de un
            teléfono de trescientos noventa, y en una tableta dejaba la frase en una
            columna estrecha con media caja vacía al lado. */}
        <View style={[styles.stageCopy, { right: width * 0.42 }]}>
          <Animated.View style={waiting} pointerEvents="none">
            <Text role="body" size="md" color="secondary">
              Elige uno abajo y verás aquí a dónde te lleva.
            </Text>
          </Animated.View>
          <Animated.View style={[styles.stageNaming, arrived]} pointerEvents="none">
            <Text role="display" size="3xl" uppercase numberOfLines={2}>
              {shown?.name ?? ''}
            </Text>
            <Text role="body" size="sm" color="secondary" style={styles.why}>
              {shown?.why ?? ''}
            </Text>
          </Animated.View>
        </View>

        <Animated.View
          style={[styles.check, { backgroundColor: accent }, lit]}
          pointerEvents="none"
        >
          <FoundationIcon
            name="check"
            customSize={12}
            strokeScale="compact"
            color={theme.color.accent.onAccent}
            decorative
          />
        </Animated.View>

        {/* El filo encendido al pie, que es lo que dice que el escenario ya contesta
            algo sin gastar un segundo acento en la pantalla. */}
        <Animated.View
          style={[styles.stageEdge, { backgroundColor: accent }, lit]}
          pointerEvents="none"
        />
      </Animated.View>
    </SignalBlock>
  )
}

/**
 * El resplandor. No hay degradado radial en React Native, así que es una pieza teñida
 * con el color que toque: el cian del tema cambia entre claro y oscuro y uno horneado
 * estaría mal en uno de los dos.
 */
function Halo({
  size,
  height,
  right,
  tint,
}: {
  readonly size: number
  readonly height: number
  readonly right: number
  readonly tint: string
}) {
  const spread = size * HALO_SCALE
  return (
    <Image
      source={halo}
      style={[
        styles.halo,
        {
          width: spread,
          height: spread,
          top: height - size / 2 - spread / 2,
          right: right - spread / 2 + size / 2,
          tintColor: tint,
        },
      ]}
      resizeMode="contain"
      accessible={false}
    />
  )
}

/** El antes y el después, o la única figura del objetivo que no promete un cambio. */
function Bodies({
  bodies,
  width,
  height,
  tint,
}: {
  readonly bodies: { before: number; after: number | null }
  readonly width: number
  readonly height: number
  readonly tint: string
}) {
  const beforeAspect = figureAspect(bodies.before)
  const afterAspect = bodies.after ? figureAspect(bodies.after) : 0
  const figureHeight = bodies.after
    ? pairHeight(width, height, beforeAspect, afterAspect, OVERLAP, EDGE)
    : Math.min(height, (width * 0.34) / (beforeAspect || 1))
  const afterWidth = figureHeight * afterAspect
  const beforeWidth = figureHeight * beforeAspect

  if (!bodies.after) {
    return (
      <>
        <Halo size={figureHeight} height={height} right={EDGE * 4} tint={tint} />
        <Image
          source={bodies.before}
          style={[
            styles.figure,
            {
              height: figureHeight,
              width: beforeWidth,
              right: EDGE * 4,
              top: height - figureHeight,
            },
          ]}
          resizeMode="cover"
          accessible={false}
        />
      </>
    )
  }

  return (
    <>
      <Halo
        size={figureHeight}
        height={height}
        right={EDGE + (afterWidth * OVERLAP + beforeWidth) / 2 - figureHeight / 2}
        tint={tint}
      />
      {/* Ya viene suavizada en el archivo: React Native no tiene filtro de desenfoque
          y la opacidad sola no separaba una figura de la otra. */}
      <Image
        source={bodies.before}
        style={[
          styles.figure,
          styles.behind,
          {
            height: figureHeight,
            width: beforeWidth,
            right: EDGE + afterWidth * OVERLAP,
            top: height - figureHeight,
          },
        ]}
        resizeMode="cover"
        accessible={false}
      />
      <Image
        source={bodies.after}
        style={[
          styles.figure,
          { height: figureHeight, width: afterWidth, right: EDGE, top: height - figureHeight },
        ]}
        resizeMode="cover"
        accessible={false}
      />
    </>
  )
}

/**
 * Una fila de la lista, que no cambia de sitio ni de tamaño nunca.
 *
 * El filete de la izquierda es lo que lleva la selección junto al color, que es la
 * regla de `DT-010`: el cian nunca va solo. Y el nombre no se anima —dos copias
 * cruzándose para un cambio de color costaba más de lo que valía en una fila de
 * diecisiete puntos—; lo que se mueve es el filete, que sí tiene una caja propia.
 *
 * **En la cara de texto y en caja baja**, no en la condensada en versalitas. Cinco
 * nombres en mayúsculas son cinco rótulos, y esto es una lista de frases que alguien
 * lee para elegir una. La condensada se queda arriba, en el escenario, que sí es un
 * titular: la diferencia entre las dos es lo que dice cuál manda.
 */
export function GoalRow({
  name,
  why,
  chosen,
  first,
  pressable,
  onPress,
  entering,
}: {
  readonly name: string
  readonly why: string
  readonly chosen: boolean
  readonly first: boolean
  readonly pressable: boolean
  readonly onPress: () => void
  readonly entering?: FadeInDown
}) {
  const theme = useTheme()
  const [pressing, setPressing] = useState(false)

  return (
    <Animated.View {...(entering ? { entering } : {})}>
      {first ? null : (
        <View style={[styles.hairline, { backgroundColor: theme.color.border.subtle }]} />
      )}
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: chosen, disabled: !pressable }}
        accessibilityLabel={`${name}. ${why}`}
        disabled={!pressable}
        onPress={onPress}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
        hitSlop={4}
        pressRetentionOffset={16}
        style={[
          styles.row,
          PRESS_TRANSITION,
          { transform: [{ scale: pressing ? PRESS_SCALE : 1 }] },
        ]}
      >
        <View
          style={[
            styles.rule,
            {
              backgroundColor: chosen ? theme.color.border.accent : theme.color.border.default,
              height: chosen ? 22 : 15,
            },
          ]}
        />
        <Text role="control" size="md" color={chosen ? 'accent' : 'secondary'}>
          {name}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // El degradado va fuera del borde animado: `SignalBlock` no acepta un estilo
  // animado, así que pinta el fondo y la caja de dentro lleva el filo.
  stageFill: { borderRadius: 20, overflow: 'hidden' },
  stage: { overflow: 'hidden', borderRadius: 20, borderWidth: 1 },
  // Behind the figures and off to their side, so the glow reads as light on them
  // rather than as a shape of its own.
  halo: { position: 'absolute', opacity: 0.14 },
  figure: { position: 'absolute' },
  behind: { opacity: 0.75 },
  // Las dos caras del texto apiladas en el mismo sitio, para que el cruce no derive.
  stageCopy: { position: 'absolute', left: 18, bottom: 20 },
  stageNaming: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  stageEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  why: { marginTop: 6 },
  check: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rule: { width: 3, borderRadius: 2 },
  hairline: { height: 1 },
})
