'use client'

/**
 * Whether a register has to fall back to cards because its table does not fit.
 *
 * **Three things were measured before this was written, and each killed a
 * simpler answer.**
 *
 * The viewport is the wrong ruler. A table sits inside the workspace content
 * area, and the sidebar takes 272px of it expanded, 56px collapsed and nothing
 * once it becomes a drawer. On the client directory: 980px of viewport with the
 * sidebar open leaves 688px, 860px leaves 568px, and 760px — with the sidebar
 * gone — leaves 728px. There is more room at 760 than at 980, so the relation
 * is not monotonic and no viewport width can be right. The rule this replaces
 * asked `max-width: 720px` and left a band roughly 540px wide where the table
 * no longer fitted and the cards had not arrived, so the register scrolled
 * sideways instead.
 *
 * A width per table is wrong too, and the design system says why: `Table` sets
 * `min-w-max` on the element, so a table never shrinks below its own content
 * and the width it demands is whatever that content happens to measure. The
 * billing table asks for 740px squeezed to 320px and 800px at 778px, because
 * the demand moves with where its text wraps. There is no number to copy — a
 * `704px` read off a computed style is `max-content` at that instant, not a
 * declaration — so a constant per register would be a guess that drifts the
 * first time a column's content changes.
 *
 * And watching the room alone is not enough, which is the part that is easy to
 * get wrong: the room is not what changes. A register mounts with no rows yet
 * and overflows once they arrive from the API — the container never resized,
 * the table appeared and grew inside it. So three things are watched: the space
 * available, the table that has to live in it, and the register's own contents,
 * because the table is not there to be measured when the first look happens.
 *
 * Nothing is predicted. The table renders, and if its own container overflows,
 * the register remembers the width that failed and shows cards. It goes back to
 * the table only once there is more room than the width that did not work,
 * which converges in one step and cannot oscillate.
 *
 * One presentation is rendered at a time, never both behind a `display: none`:
 * a hidden copy would put every person's name in the document twice for
 * find-in-page and leave it to be matched by anything querying the document
 * rather than the accessibility tree.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

/**
 * How much wider than the width that failed the register has to be before the
 * table is tried again. Without it, a container landing exactly on the failing
 * width would alternate on every resize frame.
 */
const ROOM_TO_TRY_AGAIN = 24

export function useCompactTable<T extends HTMLElement = HTMLElement>(): {
  compact: boolean
  measuredRef: (node: T | null) => void
} {
  const [compact, setCompact] = useState(false)
  const [node, setNode] = useState<T | null>(null)
  const widthThatFailed = useRef<number | null>(null)

  const measuredRef = useCallback((next: T | null) => setNode(next), [])

  useEffect(() => {
    if (!node) return

    let sizes: ResizeObserver | null = null
    let watchedTable: Element | null = null

    /*
     * Both observers run with the layout done and before the browser paints, so
     * flushing there swaps the presentation in the same frame. Left to React's
     * own scheduling the swap lands a frame later, and that frame paints the
     * table it was just decided does not fit — a flicker of the sideways scroll
     * this hook exists to remove.
     *
     * The call from the effect body cannot flush: a passive effect already runs
     * inside React's commit, where `flushSync` is refused and warned about. So
     * each caller passes in how to apply the answer rather than the decision
     * carrying a flag for whose turn it is.
     */
    const beforePaint = (next: boolean) => flushSync(() => setCompact(next))

    const decide = (show: (next: boolean) => void) => {
      // Follow whichever table is on screen: it arrives with the rows and
      // leaves when the register falls back to cards.
      const table = node.querySelector('[data-slot="table"]')
      if (sizes && table !== watchedTable) {
        if (watchedTable) sizes.unobserve(watchedTable)
        if (table) sizes.observe(table)
        watchedTable = table
      }

      const available = node.clientWidth
      const container = node.querySelector('[data-slot="table-container"]')
      if (container) {
        // The table is on screen: believe what it does rather than predict it.
        if (container.scrollWidth > container.clientWidth) {
          widthThatFailed.current = available
          show(true)
        }
        return
      }
      // Cards are on screen, so there is no table to measure. Try again only
      // with more room than the width that did not work.
      const failed = widthThatFailed.current
      if (failed === null || available > failed + ROOM_TO_TRY_AGAIN) show(false)
    }

    if (typeof ResizeObserver !== 'undefined') sizes = new ResizeObserver(() => decide(beforePaint))
    decide(setCompact)
    sizes?.observe(node)

    const contents =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => decide(beforePaint))
    contents?.observe(node, { childList: true, subtree: true })

    return () => {
      sizes?.disconnect()
      contents?.disconnect()
    }
  }, [node])

  return { compact, measuredRef }
}
