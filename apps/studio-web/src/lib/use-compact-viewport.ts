'use client'

/**
 * Viewports narrow enough that the brand shows its compact mark.
 *
 * This answers a question about the screen, which is why it may ask the screen:
 * which wordmark fits beside the profile's labelled controls is settled by the
 * phone it is held in, not by a container.
 *
 * The registers used to share it and no longer do. What a table needs is not a
 * viewport question — the sidebar takes between 0 and 272px of the width before
 * a register sees any of it, so the same viewport leaves wildly different room
 * — and they ask their own container instead. See `useCompactTable`.
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
