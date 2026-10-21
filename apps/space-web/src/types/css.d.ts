/** Lets components hand values to CSS custom properties through `style`. */
import 'react'

declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined
  }
}
