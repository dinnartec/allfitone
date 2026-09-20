/**
 * `PR-1`, `PR-3` and `PR-4` — writing a programme from nothing.
 *
 * The screen itself is `ProgramEditor`, shared with editing one that exists: they
 * differ only in whether something is loaded into it, and a second copy is where two
 * screens that should agree begin to drift.
 */

import { useLocalSearchParams } from 'expo-router'

import { ProgramEditor } from '../../src/components/program-editor'

export default function NewProgram() {
  // Con `programId` viene de duplicar: el borrador ya existe en el servidor y esta
  // pantalla lo continúa. Sin él, se empieza en blanco o se retoma el que hubiera.
  const { programId } = useLocalSearchParams<{ programId?: string }>()

  return programId === undefined ? <ProgramEditor /> : <ProgramEditor draftId={programId} />
}
