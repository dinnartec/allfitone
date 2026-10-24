import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  error,
  installStudioApiMock,
  relationshipState,
  type StudioApiFixture,
} from './studio-api-mock'

const ORG = activeMembership.organization_id
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1600, height: 900 }

/**
 * The one read each register waits on, and nothing else.
 *
 * Breaking every list at once does not test what it looks like it tests: the
 * page resolves the reader's roles from a `memberships` read of its own, so a
 * wide pattern takes the whole screen down to "no pudimos comprobar tu acceso"
 * and the register never reaches a state of its own. The team register's own
 * read is scoped under an organization for the same reason.
 */
const LIST_READ = {
  clientes: /\/clients(\?|$)/,
  cobros: /\/subscriptions(\?|$)/,
  integrantes: /\/organizations\/[^/]+\/memberships(\?|$)/,
  invitaciones: /\/invitations(\?|$)/,
} as const

const base = (intercept?: StudioApiFixture['intercept']) =>
  createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
    // Spread rather than passed: `exactOptionalPropertyTypes` refuses an
    // explicit `undefined` where the key itself is what may be absent.
    ...(intercept ? { intercept } : {}),
  })

/** The list read fails outright, which is the state nobody was being told about. */
const broken =
  (list: RegExp): StudioApiFixture['intercept'] =>
  (request) =>
    list.test(request.path) ? { status: 503, body: error('upstream-unavailable') } : undefined

/** Holds the list read long enough for the waiting state to be read off the page. */
const slow =
  (list: RegExp): StudioApiFixture['intercept'] =>
  async (request) => {
    if (list.test(request.path)) await new Promise((resolve) => setTimeout(resolve, 3000))
    return undefined
  }

/**
 * Invitations are not seeded by a fixture key, so an empty register is an
 * answer that has to be supplied. Without it the read is unmocked, comes back
 * 500, and the register shows an error — which reads like an empty list on
 * screen and is not one.
 */
const noInvitations: StudioApiFixture['intercept'] = (request) =>
  request.method === 'GET' && LIST_READ.invitaciones.test(request.path)
    ? { status: 200, body: { data: [], page: { next_cursor: null } } }
    : undefined

async function open(page: Page, path: string, fixture: StudioApiFixture) {
  await installStudioApiMock(page, fixture)
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/*
 * A register shows a table when it has the room and cards when it does not, and
 * the two were not saying the same thing. `TableState` marks an error as an
 * alert and an empty result as a polite status; the cards used `Empty`, a plain
 * div with neither, so narrowing the window silenced the product for anyone
 * reading it with a screen reader.
 *
 * Both presentations run from the same fixture here, so what is asserted is
 * that they agree — not that either carries some particular markup. Assertions
 * are scoped to the register's own section, because the page has alerts of its
 * own and a bare role query would answer for the wrong one.
 */
for (const [viewport, presentation] of [
  [MOBILE, 'tarjetas'],
  [DESKTOP, 'tabla'],
] as const) {
  test(`T-REGISTER-06 ${presentation}: un fallo de carga se anuncia como alerta`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await open(page, `/organizations/${ORG}/clients`, base(broken(LIST_READ.clientes)))

    const announced = page.locator('[data-client-page]').getByRole('alert')
    await expect(announced).toContainText('No pudimos cargar los clientes')
  })

  test(`T-REGISTER-06 ${presentation}: una lista vacía se anuncia como estado`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await open(page, `/organizations/${ORG}/team/invitations`, base(noInvitations))

    const announced = page.locator('[data-team-page]').getByRole('status')
    await expect(announced).toBeVisible()
    await expect(announced).toHaveAttribute('aria-live', 'polite')
  })

  test(`T-REGISTER-06 ${presentation}: mientras carga hay un indicador que gira`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await installStudioApiMock(page, base(slow(LIST_READ.clientes)))
    await page.goto(`/organizations/${ORG}/clients`)

    const register = page.locator('[data-client-page]')
    await expect(register.locator('[data-slot="spinner"]').first()).toBeVisible()
    // Deliberately no alert and no status: the wrapper's `aria-busy` already
    // says the register is working, and announcing every refetch would talk
    // over the reader. The table decided this first; the cards follow it.
    await expect(register.getByRole('alert')).toHaveCount(0)
  })
}

/*
 * The defect class this change belongs to: a register left out of something the
 * others share. One component now answers for all four, so the check is that
 * each register actually reaches it.
 */
test('T-REGISTER-07 los cuatro registros anuncian el fallo por el mismo camino', async ({
  page,
}) => {
  await page.setViewportSize(MOBILE)

  for (const [name, path] of [
    ['clientes', `/organizations/${ORG}/clients`],
    ['cobros', `/organizations/${ORG}/billing`],
    ['integrantes', `/organizations/${ORG}/team`],
    ['invitaciones', `/organizations/${ORG}/team/invitations`],
  ] as const) {
    await open(page, path, base(broken(LIST_READ[name])))
    const announced = page.locator('[data-register-card-state][data-state="error"]')
    await expect(announced, name).toBeVisible()
    await expect(announced, name).toHaveAttribute('role', 'alert')
  }
})
