'use client'

import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import { FoundationIcon } from '@allfitone/react/icons'
import { useRouter } from 'next/navigation'

import { useOrganizationContext } from './organization-context'
import { StudioFrame } from './studio-frame'

export function OrganizationReadyScreen() {
  const router = useRouter()
  const { current } = useOrganizationContext()

  return (
    <StudioFrame step="ready">
      <article data-studio-panel="ready" aria-labelledby="organization-ready-title">
        <div data-ready-primary>
          <p data-studio-eyebrow>Configuración completada</p>
          <h1 id="organization-ready-title">Tu espacio está listo.</h1>
          <p>
            Ya puedes entrar a Studio. Invitar integrantes y configurar la operación no es
            obligatorio; puedes hacerlo después.
          </p>
          <div data-ready-confirmations aria-label="Configuración completada">
            <span>
              <FoundationIcon name="success" decorative />
              Identidad confirmada
            </span>
            <span>
              <FoundationIcon name="success" decorative />
              {current.display_name} está activo
            </span>
          </div>
          <Button
            size="lg"
            onClick={() => router.replace(`/organizations/${current.organization_id}`)}
          >
            Entrar al workspace
          </Button>
        </div>

        <aside data-ready-later aria-labelledby="ready-later-title">
          <div>
            <p data-studio-eyebrow>Sin bloqueos</p>
            <h2 id="ready-later-title">Puedes hacerlo después</h2>
          </div>
          <div data-ready-later-item>
            <FoundationIcon name="people" decorative />
            <div>
              <strong>Sumar al equipo</strong>
              <p>Invita integrantes únicamente cuando vayas a trabajar con otras personas.</p>
            </div>
            <Badge variant="outline">Opcional</Badge>
          </div>
          <div data-ready-later-item>
            <FoundationIcon name="operation" decorative />
            <div>
              <strong>Configurar la operación</strong>
              <p>Podrás definir disciplinas, sedes y preferencias desde el workspace.</p>
            </div>
            <Badge variant="outline">Opcional</Badge>
          </div>
        </aside>
      </article>
    </StudioFrame>
  )
}
