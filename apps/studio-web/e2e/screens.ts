/**
 * The screens of the fourteen implemented Studio user stories, shared by the
 * suites that sweep all of them: the accessibility audit and the Design System
 * contract. Kept in one place so a new screen is added once and both sweeps
 * pick it up, rather than drifting apart.
 */
import type { Page } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  professionalCredential,
  professionalProfile,
  secondActiveMembership,
  terminatedMembership,
  type StudioApiFixture,
} from './studio-api-mock'

export interface Screen {
  stories: string
  path: string
  fixture: () => StudioApiFixture
  /** Interaction needed before the screen under audit is on the page. */
  reveal?: (page: Page) => Promise<void>
}

const workspace = `/organizations/${activeMembership.organization_id}`

const memberOfTwo = () =>
  createStudioApiFixture({
    memberships: [activeMembership, secondActiveMembership, terminatedMembership],
  })

const withProfile = () =>
  createStudioApiFixture({
    me: {
      profile: { ...professionalProfile, credentials: [professionalCredential] },
      memberships: [activeMembership, terminatedMembership],
    },
    memberships: [activeMembership],
  })

export const SCREENS: Screen[] = [
  {
    stories: 'HU-001 / HU-007 · entry and organization setup',
    path: '/',
    fixture: createStudioApiFixture,
  },
  { stories: 'HU-004 / HU-006 · workspace and memberships', path: workspace, fixture: memberOfTwo },
  { stories: 'HU-005 · professional profile', path: '/account', fixture: withProfile },
  {
    stories: 'HU-005 · declared credentials',
    path: '/account',
    fixture: withProfile,
    reveal: async (page) => {
      await page.getByRole('tab', { name: 'Credenciales opcionales' }).click()
    },
  },
  { stories: 'HU-017 · team directory', path: `${workspace}/team`, fixture: memberOfTwo },
  { stories: 'HU-018 · role catalog', path: `${workspace}/team/roles`, fixture: memberOfTwo },
  {
    stories: 'HU-015 / HU-016 · issued invitations',
    path: `${workspace}/team/invitations`,
    fixture: memberOfTwo,
  },
  {
    stories: 'HU-014 · invite a teammate',
    path: `${workspace}/team/invitations/new`,
    fixture: memberOfTwo,
  },
]
