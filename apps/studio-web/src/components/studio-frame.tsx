import { ProductLockup } from '@allfitone/react/brand'
import { Button } from '@allfitone/react/components/button'
import type { ReactNode } from 'react'

import { studioApi } from '@/lib/studio-api'

export type StudioStep = 'identity' | 'space' | 'ready'

export function StudioFrame({
  step,
  children,
  showLogout = true,
}: {
  step: StudioStep
  children: ReactNode
  showLogout?: boolean
}) {
  return (
    <main data-studio-canvas>
      <header data-studio-header>
        <ProductLockup
          product="studio"
          surface="light"
          title="Allfit Studio"
          width={169}
          height={40}
        />
        {showLogout ? (
          <div data-studio-header-actions>
            <form action={`${studioApi.apiUrl}/studio/v1/auth/logout`} method="post">
              <Button type="submit" variant="ghost" size="sm">
                Cerrar sesión
              </Button>
            </form>
          </div>
        ) : null}
      </header>
      <StudioProgress step={step} />
      <section data-studio-stage>{children}</section>
    </main>
  )
}

export function StudioProgress({ step }: { step: StudioStep }) {
  const current = step === 'identity' ? 0 : step === 'space' ? 1 : 2
  const labels = ['Identidad', 'Espacio', 'Listo']
  return (
    <nav data-studio-progress aria-label="Progreso de configuración">
      <ol>
        {labels.map((label, index) => {
          const status = index < current ? 'complete' : index === current ? 'current' : 'pending'
          return (
            <li
              key={label}
              data-progress-status={status}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span data-progress-index>{index < current ? '✓' : `0${index + 1}`}</span>
              <span data-progress-label>{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function LoadingStage({ label = 'Preparando tu espacio…' }: { label?: string }) {
  return (
    <StudioFrame step="identity" showLogout={false}>
      <div data-studio-loading role="status" aria-live="polite">
        <span data-studio-loading-mark aria-hidden="true" />
        <p>{label}</p>
      </div>
    </StudioFrame>
  )
}
