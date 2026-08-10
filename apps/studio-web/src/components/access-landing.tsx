import { ProductLockup } from '@allfitone/react/brand'
import {
  AccessDescription,
  AccessEyebrow,
  AccessHeader,
  AccessHero,
  AccessJourney,
  AccessJourneyIndex,
  AccessJourneyLabel,
  AccessJourneyStep,
  AccessMain,
  AccessPanel,
  AccessPanelAction,
  AccessPanelContent,
  AccessPanelDescription,
  AccessPanelEyebrow,
  AccessPanelHeader,
  AccessPanelNote,
  AccessPanelTitle,
  AccessShell,
  AccessTitle,
} from '@allfitone/react/components/access-shell'
import { buttonVariants } from '@allfitone/react/components/button'
import { PulseMark } from '@allfitone/react/components/pulse-mark'
import { ForwardIcon, FoundationIcon } from '@allfitone/react/icons'

import { studioApi } from '@/lib/studio-api'

export function AccessLanding() {
  return (
    <AccessShell>
      <AccessHeader>
        <ProductLockup
          product="studio"
          surface="light"
          title="Allfit Studio"
          width={169}
          height={40}
        />
      </AccessHeader>

      <AccessMain>
        <AccessHero aria-labelledby="studio-access-title">
          <AccessEyebrow>
            <PulseMark />
            Studio para espacios y profesionales
          </AccessEyebrow>
          <AccessTitle id="studio-access-title">Haz que cada entrenamiento cuente.</AccessTitle>
          <AccessDescription>
            Planifica con contexto, acompaña con claridad y ajusta sin perder la continuidad de cada
            persona.
          </AccessDescription>
        </AccessHero>

        <AccessPanel aria-labelledby="studio-panel-title">
          <AccessPanelHeader>
            <AccessPanelEyebrow>Tu espacio de trabajo</AccessPanelEyebrow>
            <AccessPanelTitle id="studio-panel-title">
              Entra. El contexto ya está listo.
            </AccessPanelTitle>
            <AccessPanelDescription>
              Accede de forma segura para continuar con tus espacios, equipo y actividad.
            </AccessPanelDescription>
          </AccessPanelHeader>

          <AccessPanelContent>
            <AccessPanelAction>
              <a
                data-slot="button"
                data-variant="default"
                className={buttonVariants({ size: 'lg' })}
                href={`${studioApi.apiUrl}/studio/v1/auth/start`}
              >
                Entrar a Studio
                <ForwardIcon data-icon="inline-end" decorative />
              </a>
            </AccessPanelAction>
          </AccessPanelContent>

          <AccessPanelNote>
            <FoundationIcon name="permissions" decorative />
            El inicio de sesión se completa con el proveedor de identidad de Allfit One.
          </AccessPanelNote>
        </AccessPanel>

        <AccessJourney aria-label="Flujo de trabajo en Studio">
          <AccessJourneyStep>
            <AccessJourneyIndex>01</AccessJourneyIndex>
            <AccessJourneyLabel>Planifica</AccessJourneyLabel>
          </AccessJourneyStep>
          <AccessJourneyStep>
            <AccessJourneyIndex>02</AccessJourneyIndex>
            <AccessJourneyLabel>Acompaña</AccessJourneyLabel>
          </AccessJourneyStep>
          <AccessJourneyStep>
            <AccessJourneyIndex>03</AccessJourneyIndex>
            <AccessJourneyLabel>Ajusta</AccessJourneyLabel>
          </AccessJourneyStep>
        </AccessJourney>
      </AccessMain>
    </AccessShell>
  )
}
