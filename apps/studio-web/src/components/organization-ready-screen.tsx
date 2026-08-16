'use client'

/**
 * Closing step of organization creation.
 *
 * It is a step, not a place: it has no route of its own. Living at
 * /organizations/[id]/ready made it addressable forever, so the URL kept
 * announcing that a space had just been created long after it had, and claimed
 * to be a sub-resource of the organization when it belongs to the flow that
 * creates one. The other steps of this flow are state too.
 */
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@allfitone/react/components/card'
import {
  SetupPanel,
  SetupPanelActions,
  SetupPanelContent,
  SetupPanelDescription,
  SetupPanelEyebrow,
  SetupPanelIntro,
  SetupPanelTitle,
} from '@allfitone/react/components/setup-shell'
import { FoundationIcon } from '@allfitone/react/icons'

import { StudioFrame } from './studio-frame'
import type { OrganizationCreated } from '@/lib/studio-api'

export function OrganizationReadyScreen({
  organization,
  onEnter,
}: {
  organization: OrganizationCreated
  onEnter: () => void
}) {
  return (
    <StudioFrame step="ready">
      <SetupPanel aria-labelledby="organization-ready-title">
        <SetupPanelIntro>
          <SetupPanelEyebrow>Configuración completada</SetupPanelEyebrow>
          <SetupPanelTitle id="organization-ready-title">Tu espacio está listo.</SetupPanelTitle>
          <SetupPanelDescription>
            Ya puedes entrar a Studio. Invitar integrantes y configurar la operación no es
            obligatorio; puedes hacerlo después.
          </SetupPanelDescription>
          <div data-ready-confirmations aria-label="Configuración completada">
            <span>
              <FoundationIcon name="success" decorative />
              Identidad confirmada
            </span>
            <span>
              <FoundationIcon name="success" decorative />
              {organization.display_name} está activo
            </span>
          </div>
          <SetupPanelActions>
            <Button size="lg" onClick={onEnter}>
              Entrar al workspace
            </Button>
          </SetupPanelActions>
        </SetupPanelIntro>

        <SetupPanelContent data-ready-later aria-labelledby="ready-later-title">
          <div>
            <SetupPanelEyebrow>Sin bloqueos</SetupPanelEyebrow>
            <h2 id="ready-later-title">Puedes hacerlo después</h2>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Sumar al equipo</CardTitle>
              <Badge variant="outline">Opcional</Badge>
            </CardHeader>
            <CardContent data-ready-later-item>
              <FoundationIcon name="people" decorative />
              <p>Invita integrantes únicamente cuando vayas a trabajar con otras personas.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Configurar la operación</CardTitle>
              <Badge variant="outline">Opcional</Badge>
            </CardHeader>
            <CardContent data-ready-later-item>
              <FoundationIcon name="operation" decorative />
              <p>Podrás definir disciplinas, sedes y preferencias desde el workspace.</p>
            </CardContent>
          </Card>
        </SetupPanelContent>
      </SetupPanel>
    </StudioFrame>
  )
}
