export function vercelExecutionRegion(vercelId) {
  if (!vercelId) return undefined
  const segments = vercelId.split('::')
  return segments.length >= 2 ? segments.at(-2) : undefined
}
