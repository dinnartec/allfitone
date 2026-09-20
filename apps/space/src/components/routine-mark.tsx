/**
 * La marca de una rutina en una fila: su portada, o la letra cuando no tiene.
 *
 * Vive aquí y no dentro de una pantalla porque la usan dos —el editor de programa y la
 * biblioteca de Entrenar— y la regla de cuándo se ve la letra tiene que ser una sola.
 * `CoverTile` decide que está vacío mirando sus hijos, así que la portada se pasa por
 * `coverArt()`, que devuelve `null` cuando no hay: un componente que no pinta nada sigue
 * siendo un elemento, y con él la pista nunca se dibujaría.
 */

import { CoverTile } from '@allfitone/react-native/cover-tile'
import { markOf } from '@allfitone/react-native/monogram'
import { Text } from '@allfitone/react-native/text'

import type { ExerciseLibrary } from '../client/exercise-library'
import type { MyRoutine } from '../client/content'
import { coverArt } from './routine-cover-art'

/** El lado del azulejo pequeño del sistema de diseño. */
export const COVER_SM = 56

/** Y el del extrapequeño, para una fila cuya altura es la del azulejo. */
export const COVER_XS = 44

export function RoutineMark({
  routine,
  library,
  size = 'sm',
}: {
  readonly routine: MyRoutine
  readonly library: ExerciseLibrary | undefined
  /** Lo alto que la fila puede permitirse. La marca es lo que la mide. */
  readonly size?: 'xs' | 'sm'
}) {
  return (
    <CoverTile
      size={size}
      hint={
        <Text role="control" size="sm" color="accent">
          {markOf(routine.title)}
        </Text>
      }
    >
      {coverArt({
        cover: routine.cover ?? undefined,
        worked: routine.muscles,
        muscles: library?.muscles ?? [],
        side: size === 'xs' ? COVER_XS : COVER_SM,
        coverUrl: routine.cover_url,
      })}
    </CoverTile>
  )
}
