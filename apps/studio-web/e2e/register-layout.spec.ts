import { expect, test, type Page } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  installStudioApiMock,
  relationshipState,
} from './studio-api-mock'

const ORG = activeMembership.organization_id

/**
 * Every register that answers with a table when it has the room: its route, the
 * section that holds it, and the list it falls back to when it does not.
 */
const REGISTERS = [
  {
    name: 'clientes',
    path: `/organizations/${ORG}/clients`,
    section: '[data-client-page]',
    cards: '[data-client-directory-card-list]',
  },
  {
    name: 'cobros',
    path: `/organizations/${ORG}/billing`,
    section: '[data-billing-page]',
    cards: '[data-billing-card-list]',
  },
  {
    name: 'integrantes',
    path: `/organizations/${ORG}/team`,
    section: '[data-team-page]',
    cards: '[data-team-directory-card-list]',
  },
  {
    name: 'invitaciones',
    path: `/organizations/${ORG}/team/invitations`,
    section: '[data-team-page]',
    cards: '[data-team-directory-card-list]',
  },
  {
    name: 'vínculo',
    path: `/organizations/${ORG}/clients/${relationshipState.relationship_id}`,
    section: '[data-relationship-state]',
    cards: '[data-relationship-grant-cards]',
  },
] as const

const fixture = () =>
  createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })

async function open(page: Page, path: string) {
  await installStudioApiMock(page, fixture())
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** What the table on screen demands against the room it was given, or null for cards. */
async function fit(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-slot="table-container"]')
    if (!container) return null
    return {
      necesita: Math.ceil(container.scrollWidth),
      tiene: Math.floor(container.clientWidth),
    }
  })
}

/**
 * The gap a container declares, and the gaps its children really stand apart.
 * Measured gaps may exceed the declared one — a child can carry its own margin
 * — but never fall short of it.
 */
async function spacing(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const declared = Number.parseFloat(getComputedStyle(element).rowGap)
    const gaps: number[] = []
    let previousBottom: number | null = null
    for (const child of Array.from(element.children)) {
      const box = child.getBoundingClientRect()
      if (previousBottom !== null) gaps.push(Math.round(box.top - previousBottom))
      previousBottom = box.bottom
    }
    return { declared, gaps }
  })
}

/*
 * The defect this suite exists for. The rule it replaces asked the viewport,
 * which cannot see the sidebar: at 980px with the sidebar expanded a register
 * had 688px of room, below what its table needed, and scrolled sideways rather
 * than falling back to cards. Both sidebar states are swept because the
 * viewport alone decides neither — there is more room at 760px with the sidebar
 * gone than at 980px with it open.
 */
for (const { name, path } of REGISTERS) {
  test(`T-REGISTER-01 ${name} never scrolls sideways, whatever the sidebar is doing`, async ({
    page,
  }) => {
    for (const width of [1600, 1280, 1100, 980, 860, 760, 600, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await open(page, path)

      for (const sidebar of ['como venga', 'al revés']) {
        if (sidebar === 'al revés') {
          const toggle = page.getByRole('button', { name: 'Abrir o cerrar navegación' })
          if (await toggle.isVisible()) {
            await toggle.click()
            await page.waitForTimeout(350)
          }
        }

        const medida = await fit(page)
        if (!medida) continue
        expect(
          medida.necesita,
          `${width}px (${sidebar}): la tabla pide ${medida.necesita} y tiene ${medida.tiene}`,
        ).toBeLessThanOrEqual(medida.tiene)
      }
    }
  })
}

/*
 * The other half. A rule that only ever errs towards cards would pass the sweep
 * above and throw away the columns on a desktop.
 */
test('T-REGISTER-02 a register with room keeps its table', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const { name, path } of REGISTERS) {
    await open(page, path)
    await expect(page.locator('table').first(), name).toBeVisible()
  }
})

/*
 * The fallback has to be reversible. Because the register remembers the width
 * that overflowed and waits for more room before trying the table again, a bug
 * in that memory would leave a window stuck on cards after it was widened back
 * — the kind of thing a sweep that only ever narrows never sees.
 */
test('T-REGISTER-03 the table comes back when the room does', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, `/organizations/${ORG}/clients`)
  await expect(page.locator('table')).toHaveCount(0)

  await page.setViewportSize({ width: 1600, height: 900 })
  await expect(page.locator('table').first()).toBeVisible()
})

/*
 * Billing was missing from the rule that stacks a register's own parts, so its
 * description, its filters and its table sat flush against one another at every
 * width — in the table as much as in the cards. The defect was not a wrong
 * value, it was a register left out of a shared rule, which is why this checks
 * every register rather than that one.
 */
test('T-REGISTER-04 a register stands its own parts apart', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  for (const { name, path, section } of REGISTERS) {
    await open(page, path)
    const medida = await spacing(page, section)
    expect(medida.declared, `${name}: la sección no declara separación`).toBeGreaterThan(0)
    for (const gap of medida.gaps) {
      expect(gap, `${name}: partes separadas por ${gap}px`).toBeGreaterThanOrEqual(
        Math.round(medida.declared),
      )
    }
  }
})

/*
 * The same omission one level down: the cards a register falls back to were
 * flush against each other and against the note below them.
 *
 * Two things are checked, because one register can only answer for one of them:
 * that the rule declares a gap at all, which is what billing was missing and
 * what it can show with its single card, and that the cards on screen really
 * stand that far apart, which needs a register the fixture gives two rows. A
 * register whose fixture gives it nothing renders its empty state instead and
 * has no list to read.
 */
test('T-REGISTER-05 the cards a register falls back to are separated', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let rulesChecked = 0
  let pairsChecked = 0

  for (const { name, path, cards } of REGISTERS) {
    await open(page, path)
    await expect(page.locator('table')).toHaveCount(0)
    if ((await page.locator(cards).count()) === 0) continue

    const medida = await spacing(page, cards)
    rulesChecked += 1
    expect(medida.declared, `${name}: la regla no declara separación`).toBeGreaterThan(0)
    for (const gap of medida.gaps) {
      pairsChecked += 1
      expect(gap, `${name}: tarjetas separadas por ${gap}px`).toBe(Math.round(medida.declared))
    }
  }

  // Otherwise a fixture that stopped returning rows would make this test pass
  // without having read a single rule or compared a single pair of cards.
  expect(rulesChecked, 'ningún registro llegó a mostrar su lista').toBeGreaterThan(0)
  expect(pairsChecked, 'ningún registro tenía dos tarjetas que comparar').toBeGreaterThan(0)
})
