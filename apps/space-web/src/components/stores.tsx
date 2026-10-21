/**
 * App Store and Google Play buttons.
 *
 * Until the app is published there is nowhere to send anybody, so each button is
 * plain text reading «Próximamente en». Setting its URL in the environment turns
 * it into a real link, with no code change.
 */

import type { Dictionary } from '@/content'

const STORES = [
  { key: 'appStore', url: process.env.NEXT_PUBLIC_APP_STORE_URL },
  { key: 'googlePlay', url: process.env.NEXT_PUBLIC_PLAY_STORE_URL },
] as const

export function Stores({ copy }: { copy: Dictionary['stores'] }) {
  return (
    <div className="stores">
      {STORES.map(({ key, url }) =>
        url ? (
          <a key={key} className="store" href={url} rel="noopener">
            <small>{copy.download}</small>
            <strong>{copy[key]}</strong>
          </a>
        ) : (
          <p key={key} className="store">
            <small>{copy.soon}</small>
            <strong>{copy[key]}</strong>
          </p>
        ),
      )}
    </div>
  )
}
