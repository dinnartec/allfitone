'use client'

/**
 * Viewports too narrow for a five-column directory.
 *
 * The table and the card list render one at a time rather than both behind a
 * CSS toggle: duplicating the rows would double the DOM, put every member's
 * name in the document twice for find-in-page, and leave the hidden copy to be
 * matched by anything querying the document rather than the accessibility tree.
 */
import { useEffect, useState } from 'react'

const COMPACT_MAX_WIDTH = 720

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`)
    const sync = () => setCompact(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return compact
}
