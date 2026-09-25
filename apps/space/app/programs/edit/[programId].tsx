/**
 * Reopening a programme somebody wrote.
 *
 * Two segments rather than one, so it cannot collide with `/programs/{versionId}`,
 * which is the catalogue's detail and matches a single segment.
 *
 * Only programmes with a draft reach here — a programme taken from Allfit was forked
 * and never given one — and the list is what decides, through `editable`.
 */

import { useLocalSearchParams } from 'expo-router'

import { ProgramEditor } from '../../../src/components/program-editor'

export default function EditProgram() {
  const { programId } = useLocalSearchParams<{ programId: string }>()

  return <ProgramEditor programId={programId} />
}
