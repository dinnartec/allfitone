/**
 * `/programs` — the catalogue as a screen pushed over the tabs.
 *
 * The screen itself is `ProgramCatalogue`, because the Entrenar tab draws the same
 * thing when somebody follows no programme. This route is the version with a back
 * arrow: it is reached from somewhere, and it has somewhere to return to.
 */

import { ProgramCatalogue } from '../../src/components/program-catalogue'

export default function Programs() {
  return <ProgramCatalogue />
}
