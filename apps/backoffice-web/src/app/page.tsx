import { BrandLockup } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import {
  WorkspaceActions,
  WorkspaceContent,
  WorkspaceHeader,
  WorkspaceMain,
  WorkspaceShell,
} from '@allfitone/react/components/workspace-shell'
import { FoundationIcon } from '@allfitone/react/icons'

export default function HomePage() {
  return (
    <WorkspaceShell>
      <WorkspaceMain>
        <WorkspaceHeader>
          <BrandLockup surface="dark" title="Allfit One" width={148} height={40} />
          <WorkspaceActions>
            <Badge variant="outline">Backoffice</Badge>
          </WorkspaceActions>
        </WorkspaceHeader>

        <WorkspaceContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoundationIcon name="permissions" decorative />
              </EmptyMedia>
              <EmptyTitle>Control y soporte para todo Allfit One.</EmptyTitle>
              <EmptyDescription>
                El punto de entrada del equipo interno para operar la plataforma con permisos
                explícitos, trazabilidad y protección de los datos sensibles.
              </EmptyDescription>
            </EmptyHeader>

            <EmptyContent>
              <Alert live="off" variant="warning">
                <AlertTitle>Acceso pendiente</AlertTitle>
                <AlertDescription>
                  El acceso se habilitará cuando el flujo de MFA esté conectado. Acceso exclusivo
                  para el equipo autorizado.
                </AlertDescription>
              </Alert>
            </EmptyContent>
          </Empty>
        </WorkspaceContent>
      </WorkspaceMain>
    </WorkspaceShell>
  )
}
