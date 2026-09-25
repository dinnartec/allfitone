import { ProductWordmark } from '@allfitone/react/brand'
import { Card, CardContent } from '@allfitone/react/components/card'
import {
  SetupHeader,
  SetupMain,
  SetupProgress,
  SetupProgressStep,
  SetupShell,
  SetupStage,
} from '@allfitone/react/components/setup-shell'
import { Spinner } from '@allfitone/react/components/spinner'
import type { ReactNode } from 'react'

import { LogoutForm } from './logout-form'

export type StudioStep = 'identity' | 'space' | 'ready'

/**
 * `step` is optional on purpose. The progress bar asserts where a person is in
 * setup, and a stage that has not resolved yet does not know: a signed-out
 * visitor is heading for the access landing, which has no setup at all, and
 * someone with a membership is heading straight into their organization.
 * Omitting the step renders the frame without claiming a position.
 */
export function StudioFrame({
  step,
  children,
  showLogout = true,
}: {
  step?: StudioStep
  children: ReactNode
  showLogout?: boolean
}) {
  return (
    <SetupShell data-studio-canvas>
      <SetupHeader data-studio-header>
        <ProductWordmark
          product="studio"
          surface="light"
          title="Allfit Studio"
          width={138}
          height={28}
        />
        {showLogout ? (
          <div data-studio-header-actions>
            {/* Setup runs on a gradient, where a transparent control has no edge of
                its own — the same reason the privacy control got a surface. */}
            <LogoutForm variant="secondary" />
          </div>
        ) : null}
      </SetupHeader>
      <SetupMain>
        {step ? <StudioProgress step={step} /> : null}
        <SetupStage data-studio-stage>{children}</SetupStage>
      </SetupMain>
    </SetupShell>
  )
}

export function StudioProgress({ step }: { step: StudioStep }) {
  const current = step === 'identity' ? 0 : step === 'space' ? 1 : 2
  const labels = ['Identidad', 'Espacio', 'Listo']

  return (
    <SetupProgress data-studio-progress aria-label="Progreso de configuración">
      {labels.map((label, index) => (
        <SetupProgressStep
          key={label}
          status={index < current ? 'complete' : index === current ? 'current' : 'pending'}
          index={index + 1}
          label={label}
        />
      ))}
    </SetupProgress>
  )
}

const LOADING_LABEL = 'Preparando tu espacio…'

/**
 * The card with no chrome around it, for a wait that has none to show yet.
 * A route whose fallback sits above the workspace shell has no header of its
 * own, and borrowing the setup frame's announces one that is replaced a moment
 * later.
 */
export function LoadingCard({ label = LOADING_LABEL }: { label?: string }) {
  return (
    <div data-studio-loading-overlay>
      <Card data-studio-loading>
        <CardContent data-studio-loading-body role="status" aria-live="polite">
          <Spinner role={undefined} aria-hidden="true" />
          <p>{label}</p>
        </CardContent>
      </Card>
    </div>
  )
}

/** The same card inside the setup frame, for the waits that happen during setup. */
export function LoadingStage({ label = LOADING_LABEL }: { label?: string }) {
  return (
    <StudioFrame showLogout={false}>
      <LoadingCard label={label} />
    </StudioFrame>
  )
}
