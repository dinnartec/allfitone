'use client'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button, buttonVariants } from '@allfitone/react/components/button'
import Link from 'next/link'
import { useEffect } from 'react'

import { StudioFrame } from '@/components/studio-frame'

/**
 * The boundary for an error thrown while rendering a route. Without it Next
 * falls back to its own page, which is unstyled and in English, and the person
 * is left with no way back.
 *
 * `reset` re-renders the segment, which is worth offering because most of these
 * are transient; the link out is there for when it is not. The cause is logged
 * once rather than swallowed — a boundary that shows a friendly sentence and
 * drops the error is a debugging black hole.
 */
export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <StudioFrame showLogout={false}>
      <div data-studio-error-stage>
        <Alert variant="danger" live="assertive">
          <AlertTitle role="heading" aria-level={1}>
            No pudimos mostrar esta página
          </AlertTitle>
          <AlertDescription>
            Falló al dibujarse. No se perdió nada de lo que ya habías guardado.
          </AlertDescription>
          <AlertAction>
            <Button size="lg" onClick={reset}>
              Reintentar
            </Button>
            <Link
              href="/"
              data-slot="button"
              data-variant="outline"
              className={buttonVariants({ size: 'lg', variant: 'outline' })}
            >
              Volver a Studio
            </Link>
          </AlertAction>
        </Alert>
      </div>
    </StudioFrame>
  )
}
