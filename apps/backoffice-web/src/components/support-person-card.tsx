'use client'

/**
 * `HU-BO-007` — the operational state of a person, minimised.
 *
 * The card refuses to load without a case reference rather than defaulting to
 * one. That is not strictness for its own sake: the read is recorded against
 * that reference, and a card that opened without one would produce a record
 * nobody can follow.
 *
 * The four blocks Allfit does not store yet are shown, not omitted. An operator
 * who simply does not see "relaciones" cannot tell whether the screen forgot it
 * or the platform lacks it, and the second is the truth. Criterion 5 asks for
 * unknown to read as empty rather than as zero; this goes one step further,
 * because "esta persona no tiene relaciones" would be a claim we cannot make.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Badge } from '@allfitone/react/components/badge'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import { Field, FieldGroup, FieldLabel } from '@allfitone/react/components/field'
import { Spinner } from '@allfitone/react/components/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@allfitone/react/components/table'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AccountRecoveryPanel } from '@/components/account-recovery'
import {
  BackofficeApiError,
  BackofficeNetworkError,
  backofficeApi,
  type SupportPersonMetadata,
} from '@/lib/backoffice-api'
import { formatInstant } from '@/lib/platform-access'
import {
  absentBlocks,
  availabilityExplanation,
  availabilityLabel,
  isValidCaseReference,
  supportMetadataMessage,
  verificationLabel,
} from '@/lib/support-metadata'

type LoadState = 'loading' | 'ready' | 'failed'

export function SupportPersonCard({ personId }: { personId: string }) {
  const caseReference = useSearchParams().get('case_reference') ?? ''
  const traceable = isValidCaseReference(caseReference)
  const [state, setState] = useState<LoadState>('loading')
  const [metadata, setMetadata] = useState<SupportPersonMetadata | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!traceable) return
    const controller = new AbortController()
    void (async () => {
      try {
        setMetadata(
          await backofficeApi.supportPersonMetadata(personId, caseReference, controller.signal),
        )
        setState('ready')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof BackofficeApiError && error.status === 401) {
          window.location.assign('/')
          return
        }
        setFailure(failureMessage(error))
        setState('failed')
      }
    })()
    return () => controller.abort()
  }, [personId, caseReference, traceable])

  if (!traceable) {
    return (
      <Alert live="polite" variant="warning">
        <AlertTitle>Esta ficha necesita una referencia de caso</AlertTitle>
        <AlertDescription>
          La consulta queda registrada contra el caso que la justifica, así que no se abre sin una.
          Vuelve a la búsqueda y empieza desde ahí.{' '}
          <Button size="sm" variant="ghost" render={<Link href="/people" />} nativeButton={false}>
            Ir a la búsqueda
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (state === 'loading') return <Spinner />

  if (state === 'failed' || !metadata) {
    return (
      <Alert live="assertive" variant="danger">
        <AlertTitle>No se pudo abrir el estado operativo</AlertTitle>
        <AlertDescription>
          {failure ?? supportMetadataMessage('upstream-unavailable')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div data-support-person>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Estado operativo
          </CardTitle>
          <CardDescription>
            Caso {caseReference}. Sin nombres ni contactos completos: para resolver un caso de
            entrenamiento, cuerpo, salud o nutrición hace falta un acceso excepcional aparte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-id">Identificador</FieldLabel>
              <code id="person-id">{metadata.person_id}</code>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-status">Estado de la cuenta</FieldLabel>
              <Badge
                id="person-status"
                variant={metadata.account_status === 'active' ? 'success' : 'secondary'}
              >
                {metadata.account_status}
              </Badge>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-since">Antigüedad</FieldLabel>
              <span id="person-since">
                Creada el {formatInstant(metadata.created_at)}
                {metadata.activated_at
                  ? ` · activada el ${formatInstant(metadata.activated_at)}`
                  : ''}
              </span>
            </Field>
          </FieldGroup>

          <Table scrollAreaLabel="Contacto y verificación">
            <TableHeader>
              <TableRow>
                <TableHead>Contacto</TableHead>
                <TableHead>Valor parcial</TableHead>
                <TableHead>Verificación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Correo</TableCell>
                <TableCell>
                  <code>{metadata.contact_email_masked ?? 'sin correo'}</code>
                </TableCell>
                <TableCell>
                  {verificationLabel(metadata.email_verified_at)}
                  {metadata.email_verified_at
                    ? ` · ${formatInstant(metadata.email_verified_at)}`
                    : ''}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Teléfono</TableCell>
                <TableCell>
                  <code>{metadata.contact_phone_masked ?? 'sin teléfono'}</code>
                </TableCell>
                <TableCell>
                  {verificationLabel(metadata.phone_verified_at)}
                  {metadata.phone_verified_at
                    ? ` · ${formatInstant(metadata.phone_verified_at)}`
                    : ''}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Acceso y pertenencia
          </CardTitle>
          <CardDescription>
            Suele resolver un caso de «no puedo entrar» sin abrir el dato de nadie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-account">Cuenta de acceso</FieldLabel>
              <span id="person-account">
                {metadata.has_access_account
                  ? `Vinculada${metadata.access_account_linked_at ? ` el ${formatInstant(metadata.access_account_linked_at)}` : ''}`
                  : 'Sin cuenta vinculada'}
              </span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-sessions">Sesiones activas</FieldLabel>
              <span id="person-sessions">{metadata.active_session_count}</span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-seen">Última actividad</FieldLabel>
              <span id="person-seen">
                {metadata.last_seen_at ? formatInstant(metadata.last_seen_at) : 'Nunca'}
              </span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-memberships">Pertenencia a organizaciones</FieldLabel>
              <span id="person-memberships">
                {metadata.active_membership_count} vigentes de {metadata.membership_count}
              </span>
            </Field>
            <Field orientation="responsive">
              <FieldLabel htmlFor="person-professional">Perfil profesional</FieldLabel>
              <span id="person-professional">
                {metadata.has_professional_profile ? 'Existe' : 'No tiene'}
              </span>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <AccountRecoveryPanel personId={personId} caseReference={caseReference} />

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Lo que esta ficha todavía no puede decir
          </CardTitle>
          <CardDescription>
            Estos bloques aparecen aunque estén vacíos, porque no verlos haría creer que la persona
            no tiene nada. La diferencia importa: aquí falta el dónde guardarlo, no el dato.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table scrollAreaLabel="Bloques sin información">
            <TableHeader>
              <TableRow>
                <TableHead>Bloque</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Qué significa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {absentBlocks(metadata).map((block) => (
                <TableRow key={block.title}>
                  <TableCell>{block.title}</TableCell>
                  <TableCell>
                    <Badge variant={block.availability === 'available' ? 'success' : 'secondary'}>
                      {availabilityLabel(block.availability)}
                    </Badge>
                  </TableCell>
                  <TableCell>{availabilityExplanation(block.availability)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function failureMessage(error: unknown): string {
  if (error instanceof BackofficeNetworkError) return supportMetadataMessage('network-unavailable')
  if (error instanceof BackofficeApiError) return supportMetadataMessage(error.code)
  return supportMetadataMessage('upstream-unavailable')
}
