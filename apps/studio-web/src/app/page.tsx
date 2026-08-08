import { BrandLockup } from '@allfitone/react/brand'
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
import { Badge } from '@allfitone/react/components/badge'
import { buttonVariants } from '@allfitone/react/components/button'
import {
  DeviceGate,
  DeviceGateContent,
  DeviceGateDescription,
  DeviceGateEyebrow,
  DeviceGateFallback,
  DeviceGateHeader,
  DeviceGateMain,
  DeviceGateTitle,
  DeviceGateVisual,
} from '@allfitone/react/components/device-gate'
import { PulseMark } from '@allfitone/react/components/pulse-mark'
import { ForwardIcon, FoundationIcon } from '@allfitone/react/icons'

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export default function HomePage() {
  return (
    <DeviceGate>
      <DeviceGateFallback aria-labelledby="studio-device-gate-title">
        <DeviceGateHeader>
          <BrandLockup surface="light" title="Allfit One" width={148} height={40} />
          <Badge variant="sport">Studio</Badge>
        </DeviceGateHeader>

        <DeviceGateMain>
          <DeviceGateVisual />
          <DeviceGateEyebrow>Dispositivo no compatible</DeviceGateEyebrow>
          <DeviceGateTitle id="studio-device-gate-title">
            Continúa en una pantalla más amplia.
          </DeviceGateTitle>
          <DeviceGateDescription>
            Allfit Studio no está disponible en celular. Ábrelo desde una tablet o un computador.
          </DeviceGateDescription>
        </DeviceGateMain>
      </DeviceGateFallback>

      <DeviceGateContent>
        <AccessShell>
          <AccessHeader>
            <BrandLockup surface="light" title="Allfit One" width={148} height={40} />
            <Badge variant="sport">Studio</Badge>
          </AccessHeader>

          <AccessMain>
            <AccessHero aria-labelledby="studio-access-title">
              <AccessEyebrow>
                <PulseMark />
                Studio para profesionales
              </AccessEyebrow>
              <AccessTitle id="studio-access-title">Haz que cada entrenamiento cuente.</AccessTitle>
              <AccessDescription>
                Planifica con contexto, acompaña con claridad y ajusta sin perder la continuidad de
                cada persona.
              </AccessDescription>
            </AccessHero>

            <AccessPanel aria-labelledby="studio-panel-title">
              <AccessPanelHeader>
                <AccessPanelEyebrow>Tu espacio de trabajo</AccessPanelEyebrow>
                <AccessPanelTitle id="studio-panel-title">
                  Entra. El contexto ya está listo.
                </AccessPanelTitle>
                <AccessPanelDescription>
                  Accede de forma segura para continuar con tus personas, planes y sesiones.
                </AccessPanelDescription>
              </AccessPanelHeader>

              <AccessPanelContent>
                <AccessPanelAction>
                  <a
                    data-slot="button"
                    data-variant="default"
                    className={buttonVariants({ size: 'lg' })}
                    href={`${apiUrl}/studio/v1/auth/start`}
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
      </DeviceGateContent>
    </DeviceGate>
  )
}
