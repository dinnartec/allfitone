'use client'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Barlow_Condensed, Manrope } from 'next/font/google'
import { useEffect } from 'react'

import { StudioFrame } from '@/components/studio-frame'

import '@allfitone/react/tokens.css'
import '@allfitone/react/app.css'
import '@allfitone/react/styles.css'
import './studio.composition.css'

/**
 * The boundary for an error thrown by the root layout itself. `error.tsx` cannot
 * catch those: it renders *inside* the layout, so when the layout is what failed
 * there is nothing left to render into. Without this file Next answers with its
 * own built-in page — unstyled, in English, and with no way back.
 *
 * That is not a theoretical risk here. `layout.tsx` mounts four providers, one
 * of which verifies the session on every route.
 *
 * Replacing the root layout means replacing everything it set up, which is why
 * this file repeats the `<html>` element, the font variables and the stylesheet
 * imports. `StudioFrame` is safe to reuse because with `showLogout={false}` it
 * renders Design System components only and reaches for no provider.
 *
 * There is no way back to a specific screen from here, and no `reset` worth
 * offering: re-rendering the segment would mount the same layout that just
 * failed. A full reload is the honest recovery, so that is the only action.
 */
const display = Barlow_Condensed({
  subsets: ['latin'],
  variable: '--afo-app-font-display',
  weight: ['500', '600', '700'],
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--afo-app-font-body',
})

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="es" data-afo-theme="light" className={`${display.variable} ${body.variable}`}>
      <body>
        <StudioFrame showLogout={false}>
          <div data-studio-error-stage>
            <Alert variant="danger" live="assertive">
              <AlertTitle role="heading" aria-level={1}>
                Studio no pudo cargarse
              </AlertTitle>
              <AlertDescription>
                Algo falló antes de que la aplicación arrancara. No se perdió nada de lo que ya
                habías guardado.
              </AlertDescription>
              <AlertAction>
                <Button onClick={() => window.location.reload()}>Recargar</Button>
              </AlertAction>
            </Alert>
          </div>
        </StudioFrame>
      </body>
    </html>
  )
}
