/**
 * The time now, refreshed on the turn of each second, for a clock drawn on screen.
 *
 * Held by the component that draws the clock and by nothing above it: the session
 * screen kept the second itself and redrew everything once a second, ~175 ms each time
 * on a development build, so a tick on a set waited behind the clock.
 */

import { useEffect, useState } from 'react'

import { nextBeatIn } from '../client/beat'

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer = setTimeout(function beat() {
      setNow(Date.now())
      timer = setTimeout(beat, nextBeatIn(Date.now()))
    }, nextBeatIn(Date.now()))
    return () => clearTimeout(timer)
  }, [])
  return now
}
