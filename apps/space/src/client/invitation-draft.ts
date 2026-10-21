/**
 * The decision she is making on one invitation, shared by «Tu invitación» (INV-4) and
 * «Decide qué pueden ver» (N-8a). Module state, like `exercise-pick.ts`: expo-router has
 * no way to hand a value back to the screen that pushed. Nothing here leaves the phone
 * until she confirms, and every category starts as a no.
 */

import type { Decision, InvitationKey, InvitationPresentation } from './gym-affiliation'

export interface InvitationDraft {
  readonly key: InvitationKey
  readonly invitation: InvitationPresentation
  relationship: Decision
  readonly scopes: Record<string, Decision>
}

let draft: InvitationDraft | undefined
// The token from the link waits here between the link and the screen, never in a URL.
let linkToken: string | undefined

export function openDraft(key: InvitationKey, invitation: InvitationPresentation): InvitationDraft {
  draft = { key, invitation, relationship: 'accepted', scopes: {} }
  return draft
}

export const currentDraft = (): InvitationDraft | undefined => draft
export const closeDraft = () => {
  draft = undefined
}

export function holdLinkToken(token: string) {
  linkToken = token
}

export const holdsLinkToken = (): boolean => linkToken !== undefined

/** Taking empties it: a link is opened once. */
export function takeLinkToken(): string | undefined {
  const token = linkToken
  linkToken = undefined
  return token
}
