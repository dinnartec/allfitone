/**
 * Las dos caras del menú de un programa: lo que se puede hacer, y la pregunta antes de
 * lo irreversible.
 *
 * **Viven aquí y no dentro de la pantalla**, por lo mismo que `CoverSheetBody`: son
 * cuerpos y no `Sheet`s. Cada pantalla tiene una sola hoja —dos `Modal` en iOS dejan la
 * segunda sin presentar, con una capa invisible comiéndose los toques—, así que quien la
 * abre decide, y esto sólo dibuja.
 *
 * **Eliminar pregunta; editar y duplicar no.** Duplicar no quita nada y editar se
 * deshace saliendo; eliminar se lleva el programa de la agenda y, con él, las rutinas que
 * sólo él usaba. Lo que se lleva se dice antes, con nombre, y no después.
 */

import { Button } from '@allfitone/react-native/button'
import { Text } from '@allfitone/react-native/text'
import { StyleSheet, View } from 'react-native'

import type { MyRoutine } from '../client/content'
import type { MyProgram } from '../client/programs'
import { removalWarning } from '../client/library'

export function ProgramMenuBody({
  program,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  readonly program: MyProgram
  readonly onEdit: () => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
}) {
  return (
    <View style={styles.actions}>
      {program.editable ? (
        <Button label="Editar" variant="secondary" icon="edit" onPress={onEdit} />
      ) : null}
      {/* Duplicar también el que no se puede editar: uno tomado de Allfit llega sin
          borrador, y la copia es la única manera de tener uno propio. */}
      <Button label="Duplicar" variant="secondary" icon="duplicate" onPress={onDuplicate} />
      <Button label="Eliminar" variant="ghost" icon="remove" onPress={onRemove} />
    </View>
  )
}

export function ProgramRemovalBody({
  program,
  routines,
  removing,
  onConfirm,
  onCancel,
}: {
  readonly program: MyProgram
  /** Las de la persona, para poder decir cuáles se van y cuáles se quedan. */
  readonly routines: readonly MyRoutine[]
  readonly removing: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  return (
    <View style={styles.actions}>
      <Text role="body" size="md" color="muted">
        {removalWarning(program, routines)}
      </Text>
      {/* Rojo, y es la primera vez que esta app lo usa en un botón: hasta ahora lo
          destructivo se dibujaba como un fantasma y se leía igual que «cancelar». */}
      <Button
        label="Eliminar"
        variant="danger"
        icon="remove"
        loading={removing}
        onPress={onConfirm}
      />
      <Button label="Cancelar" variant="secondary" onPress={onCancel} />
    </View>
  )
}

const styles = StyleSheet.create({ actions: { gap: 12 } })
