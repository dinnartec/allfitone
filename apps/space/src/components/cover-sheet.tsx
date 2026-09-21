/**
 * `FIN-3c` — elegir cómo se ven las rutinas de un programa.
 *
 * **Vive aquí y no dentro de una pantalla** porque la elección es del programa: la hoja
 * se abre desde el editor de programa, y si mañana se abre desde otro sitio tiene que
 * abrirse igual. Es un cuerpo y no una `Sheet`: cada pantalla tiene una sola, y dos
 * `Modal` en iOS dejan la segunda sin presentar con una capa invisible comiéndose los
 * toques.
 *
 * **La elección no se aplica al tocar.** Tocar un icono mueve la previa y nada más; el
 * botón de abajo es el que decide. La previa existe para comparar, y una hoja que se
 * cierra al primer toque convierte comparar en elegir a ciegas, salir y volver a entrar.
 *
 * **No cambia de alto al cambiar de pestaña.** La previa ocupa siempre lo que ocupa la
 * tarjeta más alta y el riel de iconos existe aunque sólo una pestaña lo llene. Sin eso,
 * la hoja crecía y encogía bajo el pulgar justo en el momento en que las tres son
 * comparables.
 *
 * **Y no lleva explicación debajo del selector.** Tres frases que cambian con la pestaña
 * son tres cosas que leer encima de una tarjeta que ya enseña la respuesta; la pantalla
 * se cargaba de texto para decir lo que la previa dice sola.
 */

import { Button } from '@allfitone/react-native/button'
import { CoverTile } from '@allfitone/react-native/cover-tile'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { EXAMPLE_HISTORY, type MuscleLoad } from '../client/home-preview'
import type { ExerciseLibrary } from '../client/exercise-library'
import { coverForTab, openingCover, openingTab } from '../client/cover-choice'
import {
  COVER_ICONS,
  iconCover,
  sameCover,
  type CoverKind,
  type RoutineCover,
} from '../client/routine-cover'
import { HomeCard } from './home-card'
import { coverArt } from './routine-cover-art'
import { COVER_SM } from './routine-mark'

export interface CoverPreview {
  readonly title: string
  /** «3 ejercicios · 13 series», ya compuesto por quien sabe contarlos. */
  readonly figures: string
  /** Los músculos que la rutina trabaja, que es de lo que la figura se dibuja. */
  readonly worked: readonly string[]
  /** Cuánto le toca a cada músculo, cuando quien abre la hoja puede saberlo. */
  readonly load?: readonly MuscleLoad[] | undefined
  /**
   * Dónde está la fotografía que a esa rutina le tocaría. Un número cuando es la de
   * muestra, que viaja en el paquete porque no hay ninguna rutina de la que sacarla.
   */
  readonly coverUrl: string | number | null
}

export function CoverSheetBody({
  cover,
  preview,
  library,
  onChoose,
}: {
  readonly cover: RoutineCover | undefined
  readonly preview: CoverPreview
  readonly library: ExerciseLibrary | undefined
  readonly onChoose: (next: RoutineCover | undefined) => void
}) {
  // Lo que la hoja está enseñando, que todavía no es lo que el programa lleva. Abre
  // proponiendo, nunca en blanco: una pestaña marcada sobre una tarjeta vacía es el
  // control diciendo una cosa y la tarjeta otra.
  const [pending, setPending] = useState<RoutineCover>(openingCover(cover))
  const [tab, setTab] = useState<CoverKind>(openingTab(cover))

  /** Cambiar de pestaña es cambiar de clase, y la previa lo enseña al momento. */
  const show = (kind: CoverKind) => {
    setTab(kind)
    setPending(coverForTab(kind, cover))
  }

  return (
    <View style={styles.sheet}>
      {/* Dicho una vez y no por pestaña: las cifras de la tarjeta son las mismas de
          muestra en las tres, y repetirlo tres veces sería tres maneras de decirlo. */}
      <Text role="body" size="sm" color="muted">
        Así se verá tu Home. Las cifras de la tarjeta son de muestra.
      </Text>

      {/* Apagada y con cifras de muestra: aquí se compara cómo se ve, no se entrena.
          La nota de arriba es la que declara que esas cifras no son de nadie. */}
      <HomeCard
        title={preview.title}
        figures={preview.figures}
        chip="Hoy"
        load={preview.load}
        cover={pending}
        coverUrl={preview.coverUrl}
        worked={preview.worked}
        library={library}
        history={EXAMPLE_HISTORY}
      />

      <SegmentedControl
        items={[
          { value: 'muscles', label: 'Músculos' },
          { value: 'icon', label: 'Icono' },
          { value: 'photo', label: 'Foto' },
        ]}
        value={tab}
        onChange={show}
        accessibilityLabel="Tipo de portada"
      />

      <View style={styles.rail}>
        {tab === 'icon' ? (
          // En fila y no en rejilla: debajo de la previa, tres filas de azulejos
          // empujaban el botón fuera de la hoja. Treinta y dos caben de lado.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {COVER_ICONS.map((one) => (
              <CoverTile
                key={one.icon}
                size="sm"
                selected={sameCover(pending, iconCover(one.icon))}
                onPress={() => setPending(iconCover(one.icon))}
                // El glifo no lleva palabras, así que sin esto la fila son treinta y dos
                // cuadrados sin nombre para quien la oye.
                accessibilityLabel={one.name}
              >
                {coverArt({
                  cover: iconCover(one.icon),
                  worked: preview.worked,
                  muscles: library?.muscles ?? [],
                  side: COVER_SM,
                })}
              </CoverTile>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <Button label="Usar esta portada" icon="success" onPress={() => onChoose(pending)} />

      {cover === undefined ? null : (
        <Button
          label="Quitar portada"
          variant="ghost"
          icon="remove"
          onPress={() => onChoose(undefined)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { gap: 14 },
  rail: { height: COVER_SM },
  row: { flexDirection: 'row', gap: 10, paddingRight: 4 },
})
