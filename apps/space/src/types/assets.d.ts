/**
 * Ambient declarations for static image assets.
 *
 * Metro turns an asset import into a numeric handle from the asset registry,
 * which is what `Image` accepts as a source. Expo ships declarations for CSS
 * modules but not for images, so without this the only way to reference one is
 * `require()` — which the shared lint configuration forbids, correctly.
 */

declare module '*.webp' {
  const asset: number
  export default asset
}

declare module '*.png' {
  const asset: number
  export default asset
}

declare module '*.jpg' {
  const asset: number
  export default asset
}
