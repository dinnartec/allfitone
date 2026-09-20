/**
 * `FIN-2b`, `FIN-2c` y `FIN-2d` — la tarjeta de Hoy, dibujada dentro de la hoja de
 * portada para que elegir una sea verla donde va a estar.
 *
 * **Es la tarjeta del carrusel de Hoy y no una miniatura de ella.** Está colocada por
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
 * **Las cifras de la última vez son de muestra y la nota lo dice.** Esta pantalla edita un
 * borrador que puede no haberse entrenado nunca, así que no hay tonelaje ni minutos
 * reales; dejar el hueco vacío enseñaba una tarjeta que Hoy no dibuja, y el punto de una
 * previa es ver la tarjeta entera. Lo que no aparece es la hora y la sede —«18:00 ·
 * Bodytech Chapinero»—, porque eso no es una cifra de muestra sino un servicio que no
 * existe.
 *
 * Es una imagen y no una pantalla: nada dentro se toca, y para un lector es un solo
 * elemento con una frase que lo resume.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { SignalBlock } from '@allfitone/react-native/gradient'
import { markOf } from '@allfitone/react-native/monogram'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { StyleSheet, View } from 'react-native'

import { litSlugsFor } from '../client/exercise-catalogue'
import type { ExerciseLibrary } from '../client/exercise-library'
import { INERT_SLUGS } from '../client/focus-form'
import {
  dominantRegion,
  EXAMPLE_HISTORY,
  MUSCLES_SHOWN,
  previewTitle,
  type MuscleLoad,
} from '../client/home-preview'
import { drawsSomething, type RoutineCover } from '../client/routine-cover'
import { BodyFigure, faceShowing } from './body-figure'
import { coverArt } from './routine-cover-art'

/**
 * Las medidas del diseño, sobre una tarjeta de 330.
 *
 * Absolutas y no proporcionales: la del carrusel tiene ancho fijo porque la siguiente
 * tiene que asomar por el borde, y una previa que se estirase con la pantalla enseñaría
 * una tarjeta que Hoy no dibuja en ningún teléfono.
 */
const CARD = 330
const TALL = 300
// Veinte puntos más alta que los 216 del lienzo. El nombre va en Barlow Condensed con
// un interlineado de 0,82, así que sus mayúsculas suben por encima de su propia caja y
// se pegaban al chip; el diseño lo resuelve con un cuerpo menor, y aquí es más honesto
// darle el aire que la fuente pide.
const SHORT = 236
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

/** La ventana por la que se ve la figura, y a qué tamaño se dibuja detrás. */
const WINDOW = { width: 96, height: 150 }
const FIGURE_HEIGHT = 340
const FIGURE_WIDTH = FIGURE_HEIGHT / 2

export function HomePreview({
  title,
  figures,
  load,
  cover,
  coverUrl,
  worked,
  library,
}: {
  readonly title: string
  /** «3 ejercicios · 13 series», ya compuesto por quien sabe contarlos. */
  readonly figures: string
  /** Cuánto le toca a cada músculo, cuando quien abre la hoja puede saberlo. */
  readonly load?: readonly MuscleLoad[] | undefined
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  /** Los músculos que la rutina trabaja, que es de lo que la figura se dibuja. */
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
}) {
  const theme = useTheme()
  const name = previewTitle(title)
  const photographed = cover?.kind === 'photo' && Boolean(coverUrl)

  return (
    // Alto fijo y el mismo para las tres: la hoja no puede crecer y encogerse bajo el
    // pulgar mientras alguien compara, que es el único momento en que son comparables.
    <View
      accessible
      accessibilityLabel={`Previsualización: así se verá ${name} en tu inicio`}
      importantForAccessibility="no-hide-descendants"
      style={styles.slot}
    >
      <SignalBlock
        variant="surfaceDeep"
        style={[
          styles.card,
          { height: photographed ? TALL : SHORT, borderColor: theme.color.accent.edge },
        ]}
      >
        {photographed && coverUrl ? (
          <Photographed name={name} figures={figures} coverUrl={coverUrl} />
        ) : (
          <Figured
            name={name}
            figures={figures}
            load={load}
            cover={cover}
            coverUrl={coverUrl}
            worked={worked}
            library={library}
          />
        )}
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
  coverUrl,
}: {
  readonly name: string
  readonly figures: string
  readonly coverUrl: string | number
}) {
  return (
    <>
      <Image
        source={coverUrl}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      {/* **Sin velo propio.** Las portadas del catálogo salen del lienzo con el
          tratamiento ya horneado —desaturar, enfriar, realzar y la caída al pie—, así que
          un `Scrim` encima es un segundo velo: la fotografía se pone azul y deja de
          distinguirse, que es justo lo que la portada tenía que hacer. */}
      <View style={styles.floating}>
        <Badge label="Hoy" tone="accent" />
      </View>
      <View style={styles.naming}>
        <Naming name={name} figures={figures} />
      </View>
      <View style={styles.actions}>
        <Actions />
      </View>
    </>
  )
}

/** `FIN-2c` y `FIN-2d` — el arte ocupa la columna que el filete deja libre. */
function Figured({
  name,
  figures,
  load,
  cover,
  coverUrl,
  worked,
  library,
}: {
  readonly name: string
  readonly figures: string
  readonly load: readonly MuscleLoad[] | undefined
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
}) {
  const theme = useTheme()
  const shown = (load ?? []).slice(0, MUSCLES_SHOWN)
  // La figura trae sus propias cifras cuando quien abre la hoja puede contarlas; si no,
  // la tarjeta enseña las de la última vez, que es lo que Hoy dibuja de verdad.
  const byMuscle = cover?.kind === 'muscles' && shown.length > 0

  return (
    <>
      {byMuscle ? null : <Session />}

      <View style={styles.chip}>
        <Badge label="Hoy" tone="accent" />
      </View>

      <View style={styles.headline}>
        <Naming name={name} figures={figures} />
      </View>

      <View
        style={[
          styles.rule,
          {
            backgroundColor: theme.color.border.subtle,
            width: cover?.kind === 'muscles' ? RULE_BESIDE_FIGURE : RULE,
          },
        ]}
      />

      <View style={styles.caption}>
        <Text role="eyebrow" size="2xs" color="muted">
          {byMuscle ? 'SERIES POR MÚSCULO' : EXAMPLE_HISTORY.when}
        </Text>
      </View>

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
          : EXAMPLE_HISTORY.figures.map((figure) => (
              <Figure
                key={figure.unit}
                value={figure.value}
                unit={figure.unit}
                delta={figure.delta}
              />
            ))}
      </View>

      <View style={styles.art}>
        <Art cover={cover} coverUrl={coverUrl} worked={worked} library={library} name={name} />
      </View>

      <View style={styles.actions}>
        <Actions />
      </View>
    </>
  )
}

/** El dorsal de la sesión, casi apagado: es textura de la tarjeta, no un dato que leer. */
function Session() {
  return (
    <View style={styles.session} pointerEvents="none">
      <Text role="eyebrow" size="2xs" style={styles.ghostLabel}>
        SESIÓN
      </Text>
      <Text role="display" size="6xl" style={styles.ghost}>
        {EXAMPLE_HISTORY.session}
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
      <Text role="display" size="2xl" uppercase numberOfLines={1}>
        {name}
      </Text>
      <Text role="body" size="xs" color="secondary">
        {figures}
      </Text>
    </>
  )
}

/** Los botones de Hoy, dibujados y muertos: esto es una foto de una pantalla. */
function Actions() {
  return (
    <View style={styles.row} pointerEvents="none">
      <Button
        label="Ver rutina"
        variant="secondary"
        size="sm"
        icon="checklist"
        style={styles.action}
      />
      <Button label="Empezar" size="sm" icon="start" style={styles.action} />
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
}: {
  readonly cover: RoutineCover | undefined
  readonly coverUrl: string | number | null | undefined
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
  readonly name: string
}) {
  const theme = useTheme()

  if (cover?.kind === 'muscles') {
    return <Torso worked={worked} library={library} />
  }

  const art = { cover, worked, muscles: library?.muscles ?? [], side: TILE, coverUrl }

  return (
    <View style={[styles.tile, { backgroundColor: theme.color.accent.tonal }]}>
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
}: {
  readonly worked: readonly string[]
  readonly library: ExerciseLibrary | undefined
}) {
  const lit = litSlugsFor(library?.muscles ?? [], worked)
  const lower = dominantRegion(worked, library?.muscles ?? []) === 'lower'

  return (
    <View style={styles.window}>
      <View
        style={[
          styles.figureBox,
          { left: -(FIGURE_WIDTH - WINDOW.width) / 2, top: lower ? -160 : -10 },
        ]}
      >
        <BodyFigure
          // La cara que dibuja algo, de frente primero. Una rutina de espalda vista de
          // frente es una figura sin nada encendido, y eso se lee como un fallo.
          side={faceShowing('male', lit)}
          gender="male"
          scale={FIGURE_WIDTH / 200}
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
  card: { width: CARD, borderRadius: 22, borderWidth: 1.5, overflow: 'hidden' },

  chip: { position: 'absolute', top: 12, left: PAD },
  headline: { position: 'absolute', top: 40, left: PAD, right: PAD },
  rule: { position: 'absolute', top: 102, left: PAD, height: 1 },
  caption: { position: 'absolute', top: 109, left: PAD },
  figures: { position: 'absolute', top: 124, left: PAD, flexDirection: 'row', gap: 8 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  delta: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },

  art: { position: 'absolute', top: 16, right: 12, alignItems: 'flex-end' },
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

  floating: { position: 'absolute', top: 14, left: 14 },
  // Separada de los botones lo que el diseño separa el nombre del par de acciones.
  naming: { position: 'absolute', left: PAD, right: PAD, bottom: 74 },
})
