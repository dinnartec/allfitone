import type { Metadata } from 'next'

import { NotFoundView } from '@/components/not-found-view'
import { siteUrl } from '@/lib/content'
import { body, display } from '@/lib/fonts'

import '@allfitone/react/tokens.css'
import '@allfitone/react/app.css'
import '@allfitone/react/styles.css'
import './space.composition.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Allfit Space · 404',
}

/** URLs outside the language routes skip the language root layout, so this page brings its own document. */
export default function GlobalNotFound(): React.JSX.Element {
  return (
    <html lang="es" data-afo-theme="dark" className={`${display.variable} ${body.variable}`}>
      <body>
        <NotFoundView />
      </body>
    </html>
  )
}
