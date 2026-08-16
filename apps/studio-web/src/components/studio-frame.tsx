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
            <LogoutForm />
          </div>
        ) : null}
      </SetupHeader>
      <SetupMain>
        <StudioProgress step={step} />
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

export function LoadingStage({ label = 'Preparando tu espacio…' }: { label?: string }) {
  return (
    <StudioFrame step="identity" showLogout={false}>
      <Card data-studio-loading>
        <CardContent>
          <Spinner label={label} />
          <p>{label}</p>
        </CardContent>
      </Card>
    </StudioFrame>
  )
}
