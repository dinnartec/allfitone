import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { buttonVariants } from '@allfitone/react/components/button'
import Link from 'next/link'

import { StudioFrame } from '@/components/studio-frame'

/**
 * Without this file Next answers an unknown address with its own built-in page:
 * an unstyled "404 — This page could not be found", in English, with no brand
 * and no way back. A typo, a stale bookmark or an old link in an email all reach
 * it, so it is a screen of the product whether or not anyone designed one.
 *
 * It borrows the stage the entry error uses rather than inventing a layout: the
 * same frame, the same centred alert, the same measure. `showLogout` stays off
 * because this page knows nothing about the session, and "Volver a Studio"
 * needs none — `/` resolves where each person belongs on its own.
 */
export default function NotFound() {
  return (
    <StudioFrame showLogout={false}>
      <div data-studio-error-stage>
        <Alert variant="warning">
          <AlertTitle role="heading" aria-level={1}>
            Esta página no existe
          </AlertTitle>
          <AlertDescription>
            La dirección puede estar mal escrita, o lo que buscabas ya no está donde estaba.
          </AlertDescription>
          <AlertAction>
            {/* Default size, like the other three error stages. `lg` belongs to
                the entry panel, where the action is the point of the screen. */}
            <Link href="/" data-slot="button" data-variant="default" className={buttonVariants()}>
              Volver a Studio
            </Link>
          </AlertAction>
        </Alert>
      </div>
    </StudioFrame>
  )
}
