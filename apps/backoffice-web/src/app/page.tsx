import { BrandLockup } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import {
  AccessDescription,
  AccessEyebrow,
  AccessHeader,
  AccessHero,
  AccessMain,
  AccessPanel,
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
import { FoundationIcon } from '@allfitone/react/icons'

export default function HomePage() {
  return (
    <DeviceGate>
      <DeviceGateFallback aria-labelledby="backoffice-device-gate-title">
        <DeviceGateHeader>
          <BrandLockup surface="dark" title="Allfit One" width={148} height={40} />
          <Badge variant="outline">Backoffice</Badge>
        </DeviceGateHeader>

        <DeviceGateMain>
          <DeviceGateVisual />
          <DeviceGateEyebrow>Dispositivo no compatible</DeviceGateEyebrow>
          <DeviceGateTitle id="backoffice-device-gate-title">
            Continúa en una pantalla más amplia.
          </DeviceGateTitle>
          <DeviceGateDescription>
            Allfit Backoffice no está disponible en celular. Ábrelo desde una tablet o un
            computador.
          </DeviceGateDescription>
        </DeviceGateMain>
      </DeviceGateFallback>

      <DeviceGateContent>
        <AccessShell>
          <AccessHeader>
            <BrandLockup surface="dark" title="Allfit One" width={148} height={40} />
            <Badge variant="outline">Backoffice</Badge>
          </AccessHeader>

          <AccessMain>
            <AccessHero>
              <AccessEyebrow>Operación interna</AccessEyebrow>
              <AccessTitle>Control sin atajos.</AccessTitle>
              <AccessDescription>
                El punto de entrada del equipo interno para operar Allfit One con permisos
                explícitos, trazabilidad y protección de los datos sensibles.
              </AccessDescription>
            </AccessHero>

            <AccessPanel>
              <AccessPanelHeader>
                <AccessPanelEyebrow>Acceso protegido</AccessPanelEyebrow>
                <AccessPanelTitle>En espera de MFA.</AccessPanelTitle>
                <AccessPanelDescription>
                  Backoffice permanecerá cerrado hasta que la autenticación reforzada esté
                  conectada.
                </AccessPanelDescription>
              </AccessPanelHeader>

              <AccessPanelContent>
                <Alert live="off" variant="warning">
                  <AlertTitle>Acceso pendiente</AlertTitle>
                  <AlertDescription>
                    Todavía no es posible iniciar sesión. El acceso se habilitará cuando el flujo de
                    MFA esté conectado.
                  </AlertDescription>
                </Alert>
              </AccessPanelContent>

              <AccessPanelNote>
                <FoundationIcon name="permissions" decorative />
                Acceso exclusivo para el equipo autorizado.
              </AccessPanelNote>
            </AccessPanel>
          </AccessMain>
        </AccessShell>
      </DeviceGateContent>
    </DeviceGate>
  )
}
