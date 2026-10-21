# Allfit One reusable brand assets

This directory contains the canonical reusable SVG exports derived from the current Allfit One identity.

## Asset families

- `favicon/`: rounded browser and install tiles in the established ink and cyan variants.
- `logo/`: the custom forward-leaning “1” mark in cyan, ink, or chalk.
- `wordmark/`: the outlined `ALLFIT ONE` wordmark, without the logo.
- `lockup/`: the cyan logo and outlined wordmark together.
- `product/`: Space, Studio, and Backoffice outlined wordmarks and lockups built with the shared Allfit One logo.

## Variants

- Use `on-light` when the surrounding surface is light.
- Use `on-dark` when the surrounding surface is dark.
- Use the cyan logo by default. The ink and chalk logos are monochrome alternatives for constrained contexts.
- Use the ink favicon for the dark landing treatment; use the cyan favicon for the high-visibility Design System treatment.

All logo, wordmark, lockup, and product files have transparent backgrounds; favicons use their named solid tile. The wordmark lettering is converted to vector outlines, so these SVGs do not depend on an installed or embedded font and can be reused across Next.js, React Native, design tools, and export pipelines.

## Brand colors

- Electric cyan: `#55EFFB`
- Black blue: `#030713`
- Cool chalk: `#EAFFFF`

## Usage rules

- Preserve the SVG aspect ratio.
- Do not stretch, skew, redraw, recolor, or rearrange the assets.
- Keep the cyan emphasis on `ONE` in the primary wordmark and lockup.
- Prefer the standalone logo for compact square or vertical placements.
- Prefer the wordmark when the symbol is already visible nearby.
- Prefer the lockup for primary brand identification.
- Use the exact Allfit One logo for Space, Studio, and Backoffice; there are no product-specific symbols in the current temporary architecture.
- Keep product descriptors cyan in primary wordmarks and lockups.
- Do not replace the shared logo with PulseMark, a discipline icon, or an organization logo.
- Provide “Allfit One” as accessible text when the asset is decorative or its internal title is not exposed by the host platform.

These are the canonical distributable files. `npm run check` enforces parity
between them, `src/geometry.ts`, and `assets/manifest.json`. Consumer copies are
generated artifacts and must not be edited by hand.
