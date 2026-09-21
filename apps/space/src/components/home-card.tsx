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
  MUSCLES_SHOWN,
  previewTitle,
  type MuscleLoad,
  type PreviewHistory,
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
  /** Sin acciones la tarjeta es una imagen y no se puede tocar. */
  readonly actions?: CardActions | undefined
}) {
  const theme = useTheme()
  const name = previewTitle(title)
  const photographed = cover?.kind === 'photo' && Boolean(coverUrl)
  const still = actions === undefined

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
            height: photographed ? TALL : SHORT,
            // El mismo filo en todas, y tenue. El de acento encendía la tarjeta entera
            // y se comía la fotografía, que es lo que la tarjeta tiene que enseñar.
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        {photographed && coverUrl ? (
          <Photographed
            name={name}
            figures={figures}
            chip={chip}
            coverUrl={coverUrl}
            actions={actions}
          />
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

  floating: { position: 'absolute', top: 14, left: 14 },
  // Separada de los botones lo que el diseño separa el nombre del par de acciones.
  naming: { position: 'absolute', left: PAD, right: PAD, bottom: 74 },
})
