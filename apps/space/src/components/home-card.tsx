/**
 * `FIN-2b`, `FIN-2c` y `FIN-2d` — la tarjeta del carrusel de Hoy.
 *
 * **La misma tarjeta en dos sitios.** La dibuja Hoy, con sus botones vivos, y la dibuja
 * la hoja de portada, apagada, para que elegir una portada sea verla donde va a estar.
 * Dos componentes parecidos habrían sido dos tarjetas que empiezan iguales y acaban
 * distintas, y la de la hoja dejaría de enseñar lo que promete.
 *
 * **Lo que cambia entre los dos usos son tres cosas y están en los argumentos:** el
 * rótulo del chip —el día de esa rutina, «HOY» cuando toca hoy—, si hay cifras de la
 * última vez, y si los botones hacen algo. Sin acciones la tarjeta es una imagen: un solo
 * elemento para quien la oye y nada dentro que se pueda tocar.
 *
 * **No es una miniatura del carrusel.** Está colocada por
 * posiciones absolutas y no por una columna que fluye, porque la tarjeta del diseño tiene
 * alto fijo y cada pieza cae en un sitio medido: el chip a 12, el nombre a 34, el filete
 * a 90 —corto a propósito, para dejar la columna del arte—, las cifras a 114 y los
 * botones a 168. Una columna con huecos los reparte de otra manera y el resultado se
 * parece pero no es.
 *
 * **La portada decide la composición entera, no un hueco.** Con fotografía la tarjeta
 * **es** la fotografía —chip arriba, nombre y botones abajo— y crece a trescientos
 * puntos; con icono o músculos mide doscientos dieciséis.
 *
 * **La figura va recortada, no encogida.** Un monigote entero en cien puntos deja cada
 * músculo en un píxel y no dice nada, que es exactamente lo que hacía. Se dibuja al
 * triple y se enseña por la ventana que corresponda: torso para una rutina de empuje,
 * piernas para una de pierna. Cuál, lo decide lo que la rutina trabaja.
 *
 * **Las cifras de la última vez sólo se dibujan si alguien las trae.** En la hoja son de
 * muestra y la hoja lo declara; en Hoy no hay ninguna, porque nada responde todavía el
 * tonelaje ni los minutos de la última ejecución de una rutina. Inventarlas en la
 * pantalla de verdad sería lo contrario de lo que esta tarjeta hace.
 *
 * Y nunca aparece la hora ni la sede —«18:00 · Bodytech Chapinero»—: eso no es una cifra
 * de muestra, es un servicio que no existe.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { Scrim, SignalBlock } from '@allfitone/react-native/gradient'
import { IconButton } from '@allfitone/react-native/icon-button'
import { markOf } from '@allfitone/react-native/monogram'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { litSlugsFor } from '../client/exercise-catalogue'
import type { ExerciseLibrary } from '../client/exercise-library'
import { INERT_SLUGS } from '../client/focus-form'
import {
  dominantRegion,
  MUSCLES_SHOWN,
  previewTitle,
  type MuscleLoad,
  type PreviewHistory,
} from '../client/home-preview'
import { drawsSomething, type RoutineCover } from '../client/routine-cover'
import type { LastTimeShown } from '../client/week-plan'
import { BodyFigure, faceShowing } from './body-figure'
import { coverArt } from './routine-cover-art'

/**
 * Las medidas del diseño, sobre una tarjeta de 330.
 *
 * Absolutas y no proporcionales: la del carrusel tiene ancho fijo porque la siguiente
 * tiene que asomar por el borde, y una previa que se estirase con la pantalla enseñaría
 * una tarjeta que Hoy no dibuja en ningún teléfono.
 */
const CARD = 344
const TALL = 340
// Veinte puntos más alta que los 216 del lienzo. El nombre va en Barlow Condensed con
// un interlineado de 0,82, así que sus mayúsculas suben por encima de su propia caja y
// se pegaban al chip; el diseño lo resuelve con un cuerpo menor, y aquí es más honesto
// darle el aire que la fuente pide.
const SHORT = 276
const PAD = 16

/**
 * Hasta dónde llega el filete, que es lo que deja la columna del arte libre.
 *
 * Dos medidas y no una: el azulejo del icono ocupa 54 y empieza tarde, pero la figura
 * ocupa 112 y abre los brazos hasta el borde de su ventana, así que el filete del
 * diseño le pasaba por encima.
 */
const RULE = 214
const RULE_BESIDE_FIGURE = 178
const TILE = 54

/**
 * Y el grande, para cuando la tarjeta no tiene cifras que poner debajo.
 *
 * Sin el bloque de la última vez —que hoy no responde nadie— un azulejo de 54 arriba a la
 * derecha dejaba media tarjeta vacía. El icono es de lo que la tarjeta va cuando no hay
 * nada más que decir, así que ocupa ese sitio en vez de dejar el hueco.
 */
const TILE_ALONE = 104

/**
 * El ancho de una columna de cifras cuando la figura ocupa el costado.
 *
 * Fijo sólo en ese caso: tres columnas midiendo cada una su palabra llegan hasta debajo
 * de los brazos y la tercera queda tapada. Sin figura no hace falta, y así «TONELADAS»
 * cabe entera en vez de cortarse en «TONELA…».
 */
// Medido en pantalla y no a ojo: «HOMBROS» en versalitas de diez con el interletrado
// del rótulo pide sesenta y seis, y a sesenta se cortaba en «HOMBR…». Lo que sobra se
// lo queda la ventana de la figura, que es un recorte y aguanta perder cuatro puntos.
const COLUMN_BESIDE_FIGURE = 66
const COLUMN_GAP_BESIDE_FIGURE = 4

/**
 * Cuánto tarda el giro y con qué curva.
 *
 * Trescientos veinte porque por debajo de trescientos el volteo se lee como un corte
 * entre dos pantallas y deja de ser la misma tarjeta; la curva es la del movimiento en
 * pantalla, que entra y sale despacio porque el objeto pesa.
 */
const TURN_MS = 320
const TURN_EASE = Easing.bezier(0.77, 0, 0.175, 1)

/** Las medidas del reverso, del lienzo de `FIN-2i` sobre una tarjeta de 330. */
const BARS = 152
const BAR_TRACK = 3
/**
 * La ventana del reverso es más baja que la del frente.
 *
 * Con los ciento cincuenta de la otra la figura pasaba por debajo del filete y se
 * metía entre las cifras de la última vez, que es lo único de esa mitad que hay que
 * poder leer de un vistazo. Y no más ancha que el frente: los ciento catorce del
 * lienzo dejaban asomar por los bordes dos jirones de brazo sueltos.
 */
/**
 * El alto de la columna que le queda a la figura en el reverso.
 *
 * Es el hueco entre el nombre y el filete, y no un tamaño de figura: el recorte se
 * calcula del grupo para llenarlo, así que cambiar este número cambia el tamaño de lo
 * que se dibuja sin volver a partir a nadie.
 */
const BACK_FIGURE_COLUMN = 130
/**
 * Cuánto baja el bloque de músculos cuando no hay pasado que contar.
 *
 * Sin la mitad de abajo, dejarlo donde estaba deja un tercio de tarjeta en blanco al
 * pie. Se centra en lo que hay, en vez de anunciar el hueco de lo que falta.
 */
const BACK_DROP = 44

/** La ventana por la que se ve la figura, y a qué tamaño se dibuja detrás. */
const WINDOW = { width: 96, height: 150 }
const FIGURE_HEIGHT = 340
const FIGURE_WIDTH = FIGURE_HEIGHT / 2

export interface CardActions {
  readonly onOpen: () => void
  readonly onStart: () => void
  /** «Empezar», «Continuar» o «Repetir»: lo decide quien sabe en qué va la semana. */
  readonly startLabel: string
  readonly starting: boolean
}

export function HomeCard({
  title,
  figures,
  width,
  chip,
  load,
  cover,
  coverUrl,
  worked,
  library,
  history,
  lastTime,
  actions,
}: {
  readonly title: string
  /** «3 ejercicios · 13 series», ya compuesto por quien sabe contarlos. */
  readonly figures: string
  /** Lo que el carrusel le deja ocupar. Sin esto, la medida del lienzo. */
  readonly width?: number | undefined
  /** El día de esta rutina, o «HOY» cuando es la de hoy. */
  readonly chip: string
  /** Cuánto le toca a cada músculo, cuando quien la dibuja puede saberlo. */
  readonly load?: readonly MuscleLoad[] | undefined
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  /** Los músculos que la rutina trabaja, que es de lo que la figura se dibuja. */
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  /** Las cifras de la última vez. Sin ellas la tarjeta no las finge. */
  readonly history?: PreviewHistory | undefined
  /**
   * Cómo fue la última vez, para el reverso. Su presencia es lo que hace que la tarjeta
   * se pueda girar: sin nada detrás, el botón daría la vuelta a una cara vacía.
   */
  readonly lastTime?: LastTimeShown | undefined
  /** Sin acciones la tarjeta es una imagen y no se puede tocar. */
  readonly actions?: CardActions | undefined
}) {
  const theme = useTheme()
  const name = previewTitle(title)
  const photographed = cover?.kind === 'photo' && Boolean(coverUrl)
  const still = actions === undefined

  // Se gira lo que tiene dos caras. Una rutina sin músculos curados y sin pasado no
  // tiene reverso, y ofrecer el botón sería prometer algo que al girar no está.
  const shown = (load ?? []).slice(0, MUSCLES_SHOWN)
  const turnable = !still && photographed && (shown.length > 0 || lastTime !== undefined)

  const [turned, setTurned] = useState(false)
  const reduced = useReducedMotion()
  const spin = useSharedValue(0)

  const turn = () => {
    const next = !turned
    setTurned(next)
    // Tiempo y no muelle: ningún dedo trae velocidad hasta aquí, y el rebote en algo
    // que nadie lanzó se lee como un fallo y no como peso.
    spin.set(withTiming(next ? 1 : 0, { duration: TURN_MS, easing: TURN_EASE }))
    void Haptics.selectionAsync()
  }

  // La opacidad conmuta en la mitad además de `backfaceVisibility`, que algunos
  // Android ignoran y dejan las dos caras una encima de la otra.
  const frontFace = useAnimatedStyle(() =>
    reduced
      ? { opacity: 1 - spin.get() }
      : {
          opacity: spin.get() < 0.5 ? 1 : 0,
          transform: [{ perspective: 900 }, { rotateY: `${spin.get() * 180}deg` }],
        },
  )
  const backFace = useAnimatedStyle(() =>
    reduced
      ? { opacity: spin.get() }
      : {
          opacity: spin.get() < 0.5 ? 0 : 1,
          transform: [{ perspective: 900 }, { rotateY: `${spin.get() * 180 - 180}deg` }],
        },
  )

  return (
    // Alto fijo y el mismo para las tres: ni la hoja puede crecer y encoger bajo el pulgar
    // mientras alguien compara, ni el carrusel puede cambiar de alto al deslizarse.
    <View
      accessible={still}
      accessibilityLabel={still ? `Previsualización: así se verá ${name} en tu inicio` : undefined}
      importantForAccessibility={still ? 'no-hide-descendants' : 'auto'}
      // El hueco sólo se fija en la previa, donde la hoja compara las tres y no puede
      // crecer y encoger bajo el pulgar. En el carrusel todas las tarjetas son de la
      // misma clase —la portada es del programa—, así que el hueco sobra y deja una
      // banda muerta encima y debajo.
      style={still ? styles.slot : null}
    >
      <SignalBlock
        variant="surfaceDeep"
        style={[
          styles.card,
          {
            width: width ?? CARD,
            // Girable es siempre alta: una tarjeta que cambia de estatura a mitad de
            // giro deja de leerse como la misma tarjeta dándose la vuelta.
            height: photographed || turnable ? TALL : SHORT,
            // El mismo filo en todas, y tenue. El de acento encendía la tarjeta entera
            // y se comía la fotografía, que es lo que la tarjeta tiene que enseñar.
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        {photographed && coverUrl ? (
          <Animated.View
            style={[StyleSheet.absoluteFill, turnable ? [styles.face, frontFace] : null]}
            pointerEvents={turned ? 'none' : 'auto'}
            importantForAccessibility={turned ? 'no-hide-descendants' : 'auto'}
          >
            <Photographed
              name={name}
              figures={figures}
              chip={chip}
              coverUrl={coverUrl}
              actions={actions}
            />
            {turnable ? <Turn onPress={turn} showing="front" /> : null}
          </Animated.View>
        ) : (
          <Figured
            name={name}
            figures={figures}
            chip={chip}
            load={load}
            cover={cover}
            coverUrl={coverUrl}
            worked={worked}
            library={library}
            history={history}
            actions={actions}
          />
        )}

        {turnable ? (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.face, styles.back, backFace]}
            pointerEvents={turned ? 'auto' : 'none'}
            importantForAccessibility={turned ? 'auto' : 'no-hide-descendants'}
          >
            <Reverse
              name={name}
              figures={figures}
              chip={chip}
              load={shown}
              worked={worked}
              library={library}
              lastTime={lastTime}
            />
            <Turn onPress={turn} showing="back" />
          </Animated.View>
        ) : null}
      </SignalBlock>
    </View>
  )
}

/**
 * `FIN-2b` — la fotografía es la tarjeta.
 *
 * Va a plena opacidad y sin velo propio: el tratamiento —desaturar, enfriar, contraste y
 * caída— viene horneado en el archivo del catálogo, y volver a oscurecerla aquí sería
 * oscurecerla dos veces. Lo que sí hace falta es que el texto no caiga sobre la parte
 * clara, y por eso se ancla abajo, donde la caída ya llegó.
 */
function Photographed({
  name,
  figures,
  chip,
  coverUrl,
  actions,
}: {
  readonly name: string
  readonly figures: string
  readonly chip: string
  readonly coverUrl: string | number
  readonly actions: CardActions | undefined
}) {
  return (
    <>
      <Image
        source={coverUrl}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      {/* **El velo lo pone la tarjeta, no el archivo.** Las portadas del catálogo salen
          del lienzo sin tratamiento —claras, con su color—, y lo único que hace falta es
          que el texto de abajo se lea. Hornearlo en la imagen era apagarla para todos los
          sitios donde sale, y dos veces allí donde alguien volviera a ponerlo. */}
      <Scrim height={TALL} coverage={0.999} onset={0.26} />
      <View style={styles.floating}>
        <Badge label={chip} tone="accent" variant="quiet" />
      </View>
      <View style={styles.naming}>
        <Naming name={name} figures={figures} />
      </View>
      <View style={styles.actions}>
        <Actions actions={actions} />
      </View>
    </>
  )
}

/** `FIN-2c` y `FIN-2d` — el arte ocupa la columna que el filete deja libre. */
function Figured({
  name,
  figures,
  chip,
  load,
  cover,
  coverUrl,
  worked,
  library,
  history,
  actions,
}: {
  readonly name: string
  readonly figures: string
  readonly chip: string
  readonly load: readonly MuscleLoad[] | undefined
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  readonly history: PreviewHistory | undefined
  readonly actions: CardActions | undefined
}) {
  const theme = useTheme()
  const shown = (load ?? []).slice(0, MUSCLES_SHOWN)
  // Por músculo cuando la portada los dibuja y alguien sabe contarlos; si no, las cifras
  // de la última vez, y si tampoco hay, la tarjeta se queda con el nombre.
  const byMuscle = cover?.kind === 'muscles' && shown.length > 0
  const strip = byMuscle || history !== undefined

  return (
    <>
      {byMuscle || history === undefined ? null : <Session number={history.session} />}

      <View style={styles.chip}>
        <Badge label={chip} tone="accent" variant="quiet" />
      </View>

      <View style={styles.headline}>
        <Naming name={name} figures={figures} />
      </View>

      {/* Sin cifras que poner debajo no hay filete: una línea sobre un hueco es una
          sección vacía anunciándose. */}
      {strip ? (
        <View
          style={[
            styles.rule,
            {
              backgroundColor: theme.color.border.subtle,
              width: cover?.kind === 'muscles' ? RULE_BESIDE_FIGURE : RULE,
            },
          ]}
        />
      ) : null}

      {strip ? (
        <View style={styles.caption}>
          <Text role="eyebrow" size="2xs" color="muted">
            {byMuscle ? 'SERIES POR MÚSCULO' : (history?.when ?? '')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.figures, byMuscle ? { gap: COLUMN_GAP_BESIDE_FIGURE } : null]}>
        {byMuscle
          ? shown.map((muscle) => (
              <Figure
                key={muscle.code}
                value={String(muscle.sets)}
                unit={muscle.name}
                width={COLUMN_BESIDE_FIGURE}
              />
            ))
          : (history?.figures ?? []).map((figure) => (
              <Figure
                key={figure.unit}
                value={figure.value}
                unit={figure.unit}
                delta={figure.delta}
              />
            ))}
      </View>

      <View style={strip ? styles.art : styles.artAlone}>
        <Art
          cover={cover}
          coverUrl={coverUrl}
          worked={worked}
          library={library}
          name={name}
          alone={!strip}
        />
      </View>

      <View style={styles.actions}>
        <Actions actions={actions} />
      </View>
    </>
  )
}

/**
 * El botón que da la vuelta a la tarjeta.
 *
 * Un botón y no un gesto: la tarjeta vive dentro de un carrusel horizontal, y un
 * deslizamiento que volteara competiría con el que cambia de rutina. El lienzo ya lo
 * resuelve así.
 *
 * Cuadrado redondeado y no redondo, que es la forma que lo hace parte de la tarjeta en
 * vez de una burbuja encima.
 */
function Turn({
  onPress,
  showing,
}: {
  readonly onPress: () => void
  readonly showing: 'front' | 'back'
}) {
  return (
    <View style={styles.turn}>
      <IconButton
        icon="flip"
        shape="squircle"
        size="sm"
        // Dice a dónde lleva, no qué hace: «girar» no cuenta qué aparece al girar.
        accessibilityLabel={showing === 'front' ? 'Ver el detalle' : 'Volver a la portada'}
        onPress={onPress}
      />
    </View>
  )
}

/**
 * `FIN-2i` — el reverso, que cuenta lo que la portada calla.
 *
 * Las dos secciones van **apiladas** y no alternadas como en `Figured`: ahí la tarjeta
 * tiene una sola cara y hay que elegir entre los músculos y las cifras; aquí la cara
 * existe para contarlo todo, y elegir dejaría media tarjeta vacía.
 *
 * Lo que no hay no se dibuja. Una rutina sin pasado se queda con los músculos y sin
 * filete: una línea sobre un hueco es una sección anunciándose vacía.
 */
function Reverse({
  name,
  figures,
  chip,
  load,
  worked,
  library,
  lastTime,
}: {
  readonly name: string
  readonly figures: string
  readonly chip: string
  readonly load: readonly MuscleLoad[]
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  readonly lastTime: LastTimeShown | undefined
}) {
  const theme = useTheme()
  // Proporcional al músculo que más trabaja y no a un máximo inventado: la barra dice
  // cómo se reparte el trabajo de esta rutina, no cuánto es mucho en general.
  const most = load.reduce((top, one) => Math.max(top, one.sets), 0)
  const drop = lastTime === undefined ? BACK_DROP : 0

  return (
    <>
      <View style={styles.backWhen}>
        <Badge label={chip} tone="accent" variant="quiet" />
      </View>

      <View style={styles.backNaming}>
        <Text role="display" size="3xl" uppercase numberOfLines={1}>
          {name}
        </Text>
        <Text role="body" size="sm" color="secondary">
          {figures}
        </Text>
      </View>

      {load.length === 0 ? null : (
        <>
          <View style={[styles.backMusclesLabel, { top: 120 + drop }]}>
            <Text role="eyebrow" size="xs" color="muted">
              SERIES POR MÚSCULO
            </Text>
          </View>

          <View style={[styles.backMuscles, { top: 146 + drop }]}>
            {load.map((muscle) => (
              <View key={muscle.code} style={styles.muscleRow}>
                <View style={styles.muscleHead}>
                  {/* La cara de texto y en caja baja: el músculo es un nombre, no un
                      rótulo, y la condensada aprieta las letras hasta volverlo etiqueta.
                      `control` es la de texto con el interlineado compacto que la fila
                      necesita para no empujar al filete. */}
                  <Text role="control" size="sm" color="secondary" numberOfLines={1}>
                    {muscle.name}
                  </Text>
                  {/* `data` y no `display`: es la cifra condensada con números
                      tabulares, que es lo que el sistema reserva para una métrica. */}
                  <Text role="data" size="md">
                    {String(muscle.sets)}
                  </Text>
                </View>
                <View style={[styles.track, { backgroundColor: theme.color.border.subtle }]}>
                  <View
                    style={[
                      styles.fill,
                      {
                        backgroundColor: theme.color.icon.accent,
                        width: `${most === 0 ? 0 : (muscle.sets / most) * 100}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.backFigure, { top: 112 + drop }]}>
            <Torso worked={worked} library={library} height={BACK_FIGURE_COLUMN} fit="region" />
          </View>
        </>
      )}

      {lastTime === undefined ? null : (
        <>
          <View style={[styles.backRule, { backgroundColor: theme.color.border.subtle }]} />
          <View style={styles.backSince}>
            <Text role="eyebrow" size="xs" color="muted" numberOfLines={1}>
              {lastTime.when}
            </Text>
          </View>
          <View style={styles.backFigures}>
            {lastTime.figures.map((figure) => (
              <View key={figure.unit} style={styles.backFigureColumn}>
                <Figure value={figure.value} unit={figure.unit} />
              </View>
            ))}
          </View>
        </>
      )}
    </>
  )
}

/** El dorsal de la sesión, casi apagado: es textura de la tarjeta, no un dato que leer. */
function Session({ number }: { readonly number: string }) {
  return (
    <View style={styles.session} pointerEvents="none">
      <Text role="eyebrow" size="2xs" style={styles.ghostLabel}>
        SESIÓN
      </Text>
      <Text role="display" size="6xl" style={styles.ghost}>
        {number}
      </Text>
    </View>
  )
}

function Figure({
  value,
  unit,
  delta,
  width,
}: {
  readonly value: string
  readonly unit: string
  readonly delta?: string | undefined
  /** Fijo sólo cuando la figura ocupa el costado; si no, la columna la mide su palabra. */
  readonly width?: number | undefined
}) {
  const theme = useTheme()
  return (
    // Ancho fijo: los números bailarían si cada columna midiese su propia palabra.
    <View style={width === undefined ? undefined : { width }}>
      <View style={styles.value}>
        <Text role="display" size="3xl">
          {value}
        </Text>
        {delta === undefined ? null : (
          <View style={[styles.delta, { backgroundColor: theme.color.accent.tonal }]}>
            <Text role="eyebrow" size="2xs" color="accent">
              {delta}
            </Text>
          </View>
        )}
      </View>
      <Text role="eyebrow" size="2xs" color="muted" numberOfLines={1}>
        {unit.toUpperCase()}
      </Text>
    </View>
  )
}

function Naming({ name, figures }: { readonly name: string; readonly figures: string }) {
  return (
    <>
      <Text role="display" size="3xl" uppercase numberOfLines={1}>
        {name}
      </Text>
      <Text role="body" size="sm" color="secondary">
        {figures}
      </Text>
    </>
  )
}

/** Los dos botones. Sin acciones se dibujan igual y no se pueden tocar: es una previa. */
function Actions({ actions }: { readonly actions: CardActions | undefined }) {
  return (
    <View style={styles.row} pointerEvents={actions === undefined ? 'none' : 'auto'}>
      {/* En `md` y no en `sm`: el lienzo los dibuja a cuarenta, y el tamaño compacto
          del sistema se queda en treinta y seis. Cuarenta y cuatro es además el suelo
          táctil, que en el botón que empieza un entrenamiento no es un detalle. */}
      <Button
        label="Ver rutina"
        variant="secondary"
        icon="checklist"
        style={styles.action}
        onPress={actions?.onOpen}
      />
      <Button
        label={actions?.startLabel ?? 'Empezar'}
        icon="start"
        style={styles.action}
        loading={actions?.starting ?? false}
        onPress={actions?.onStart}
      />
    </View>
  )
}

/**
 * Dónde cae la portada, que depende de qué clase es.
 *
 * La fotografía nunca llega aquí: ya es la tarjeta entera. Lo que queda es la figura, que
 * ocupa la columna, y el icono, que es un azulejo arriba — y la letra, porque una rutina
 * sin portada es un estado legítimo y «quitar portada» sería un botón a ciegas si la
 * previa no lo enseñara.
 */
function Art({
  cover,
  coverUrl,
  worked,
  library,
  name,
  alone,
}: {
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  readonly name: string
  readonly alone: boolean
}) {
  const theme = useTheme()

  if (cover?.kind === 'muscles') {
    return <Torso worked={worked} library={library} />
  }

  const side = alone ? TILE_ALONE : TILE
  const art = { cover, worked, muscles: library?.muscles ?? [], side, coverUrl }

  return (
    <View
      style={[
        styles.tile,
        { width: side, height: side, backgroundColor: theme.color.accent.tonal },
      ]}
    >
      {/* La letra también cuando la fotografía todavía no ha llegado: un azulejo vacío
          bajo la pestaña «Foto» parece un control que no hizo nada. Se pregunta antes de
          construir el elemento, porque uno que no pinta nada sigue siendo un elemento. */}
      {drawsSomething(cover, coverUrl) ? (
        coverArt(art)
      ) : (
        <Text role="control" size="lg" color="accent">
          {markOf(name)}
        </Text>
      )}
    </View>
  )
}

/**
 * La figura, dibujada grande y enseñada por una ventana.
 *
 * Lo que decide el recorte es lo que la rutina trabaja: torso arriba, piernas abajo. Un
 * recorte fijo de torso dejaría una rutina de pierna con una ventana sin nada encendido,
 * que es lo mismo que enseñar la figura equivocada.
 */
function Torso({
  worked,
  library,
  window: given = WINDOW,
  height = FIGURE_HEIGHT,
  fit = 'window',
}: {
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  /** Por dónde se recorta, cuando la recorta quien la pide. */
  readonly window?: { readonly width: number; readonly height: number }
  /** A qué tamaño se dibuja la figura detrás de la ventana. */
  readonly height?: number
  /**
   * **`region` recorta al grupo, no a un cuadro.**
   *
   * Un par de piernas es alto y estrecho y un torso es ancho y bajo, así que una sola
   * ventana para los dos o parte las piernas o corta los brazos. Peor: una ventana más
   * ancha que las caderas pesca las manos que cuelgan al costado y las deja flotando
   * al lado de las piernas, que es lo que se veía.
   *
   * Las proporciones salen de la figura, que se dibuja en un rectángulo de dos a uno:
   * la cadera cae a la mitad, las piernas ocupan poco más de un cuarto del ancho y el
   * torso con los brazos abiertos casi la mitad.
   */
  readonly fit?: 'region' | 'window'
}) {
  const lit = litSlugsFor(library?.muscles ?? [], worked)
  const lower = dominantRegion(worked, library?.muscles ?? []) === 'lower'

  // `region` recibe el alto de la columna y deduce a qué tamaño hay que dibujar la
  // figura para que el grupo quepa justo: las piernas son la mitad de la figura y el
  // tronco con la cadera algo más, así que no es el mismo tamaño para los dos.
  const span = lower ? 0.5 : 0.54
  const drawn = fit === 'window' ? height : height / span
  const width = drawn / 2
  const frame = fit === 'window' ? given : { width: drawn * (lower ? 0.26 : 0.44), height }
  const top =
    fit === 'window'
      ? lower
        ? -height * 0.47
        : -height * 0.03
      : lower
        ? -drawn * 0.5
        : -drawn * 0.04

  return (
    <View style={[styles.window, { width: frame.width, height: frame.height }]}>
      <View
        style={[styles.figureBox, { width, height: drawn, left: -(width - frame.width) / 2, top }]}
      >
        <BodyFigure
          // La cara que dibuja algo, de frente primero. Una rutina de espalda vista de
          // frente es una figura sin nada encendido, y eso se lee como un fallo.
          side={faceShowing('male', lit)}
          gender="male"
          scale={width / 200}
          lit={lit}
          inert={INERT_SLUGS}
          onPressSlug={() => undefined}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Centrada y con el alto de la más alta: la hoja no cambia de tamaño al cambiar de
  // pestaña, aunque la tarjeta de fotografía sea más alta que las otras dos.
  slot: { height: TALL, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 24, borderWidth: 1, overflow: 'hidden' },

  chip: { position: 'absolute', top: 12, left: PAD },
  headline: { position: 'absolute', top: 40, left: PAD, right: PAD },
  rule: { position: 'absolute', top: 102, left: PAD, height: 1 },
  caption: { position: 'absolute', top: 109, left: PAD },
  figures: { position: 'absolute', top: 124, left: PAD, flexDirection: 'row', gap: 8 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  delta: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },

  art: { position: 'absolute', top: 16, right: 12, alignItems: 'flex-end' },
  // Sin cifras debajo, el icono se queda con la banda que dejan el nombre y los botones.
  // Centrado en la banda que queda entre las cifras y los botones: noventa y dos de
  // arriba, ciento ochenta y ocho de abajo. Con ciento cuatro se metía debajo de
  // «Empezar», que es la única cosa de la tarjeta que no puede taparse.
  artAlone: { position: 'absolute', top: 108, right: 16, alignItems: 'flex-end' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  window: { width: WINDOW.width, height: WINDOW.height, overflow: 'hidden' },
  figureBox: { position: 'absolute', width: FIGURE_WIDTH, height: FIGURE_HEIGHT },

  session: { position: 'absolute', top: 104, right: PAD, alignItems: 'flex-end' },
  ghostLabel: { opacity: 0.12 },
  ghost: { opacity: 0.08 },

  actions: { position: 'absolute', left: PAD, right: PAD, bottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },

  face: { backfaceVisibility: 'hidden' },
  // El degradado del lienzo, que es lo que distingue el reverso de la cara del frente
  // sin que deje de ser la misma tarjeta.
  back: { backgroundColor: '#071822' },
  turn: { position: 'absolute', top: 14, right: 14 },

  backWhen: { position: 'absolute', top: 16, left: PAD },
  // Ocho puntos más abajo que el lienzo: la condensada en versalitas sube por encima
  // de su propia caja y el nombre se pegaba al badge del día.
  backNaming: { position: 'absolute', top: 54, left: PAD, right: 72 },
  backMusclesLabel: { position: 'absolute', top: 120, left: PAD },
  // Con la versalita a doce, tres filas y sus aires miden ochenta y nueve: el sitio
  // que hay entre el rótulo y el filete, y ni un punto más.
  backMuscles: { position: 'absolute', top: 146, left: PAD, width: BARS + 12, gap: 7 },
  muscleRow: { gap: 6 },
  muscleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: BAR_TRACK, borderRadius: 2, overflow: 'hidden' },
  fill: { height: BAR_TRACK, borderRadius: 2 },
  backFigure: { position: 'absolute', top: 112, right: 14, alignItems: 'flex-end' },
  backRule: { position: 'absolute', left: PAD, right: PAD, bottom: 88, height: 1 },
  backSince: { position: 'absolute', left: PAD, bottom: 72 },
  backFigures: {
    position: 'absolute',
    left: PAD,
    right: PAD,
    bottom: 14,
    flexDirection: 'row',
    gap: 8,
  },
  backFigureColumn: { flex: 1 },

  floating: { position: 'absolute', top: 14, left: 14 },
  // Separada de los botones lo que el diseño separa el nombre del par de acciones.
  naming: { position: 'absolute', left: PAD, right: PAD, bottom: 74 },
})
