/** Milliseconds until the next whole second: when a clock on screen next changes. */
export function nextBeatIn(now: number): number {
  return 1000 - (now % 1000)
}
