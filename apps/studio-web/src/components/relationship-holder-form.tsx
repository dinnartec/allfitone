'use client'

/**
 * Putting a coach in charge of a client, from inside the relationship screen.
 *
 * It only ever appears where the command would succeed: a live relationship,
 * nobody in charge of it yet, and a caller whose role carries
 * `assign_professionals`. Showing it anywhere else spends a click to reach a
 * refusal.
 *
 * The list offers only active coaches of this same organization, because those
 * are the only memberships PostgreSQL accepts. A professional from another gym
 * can never be assigned, even when the person is a client of both.
 */

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@allfitone/react/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@allfitone/react/components/select'
import { Spinner } from '@allfitone/react/components/spinner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import {
  refusalDescription,
  refusalFor,
  refusalTitle,
  type AssignmentRefusal,
} from '@/lib/relationship-holder'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { OrganizationMembership } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function RelationshipHolderForm({
  organizationId,
  relationshipId,
  coaches,
  loadingCoaches,
}: {
  organizationId: string
  relationshipId: string
  coaches: readonly OrganizationMembership[]
  loadingCoaches: boolean
}) {
  const fieldId = useId()
  const queryClient = useQueryClient()
  const [membershipId, setMembershipId] = useState('')
  const [refusal, setRefusal] = useState<AssignmentRefusal | null>(null)

  const assign = useMutation({
    mutationFn: (chosen: string) =>
      studioApi.assignRelationshipHolder(
        organizationId,
        relationshipId,
        { membership_id: chosen },
        newCommand(),
      ),
    onSuccess: async () => {
      setRefusal(null)
      /*
       * Refetch rather than write the answer into the cache. The screen shows
       * who attends *and* what they may read, and only the server knows whether
       * anything else changed while this was in flight.
       */
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.relationship(organizationId, relationshipId),
      })
    },
    onError: (error) => {
      setRefusal(refusalFor(error instanceof StudioApiError ? error.status : undefined))
    },
  })

  const options = coaches.map((coach) => ({
    value: coach.membership_id,
    label: coach.display_name,
  }))

  if (!loadingCoaches && options.length === 0) {
    return (
      <p data-relationship-no-coaches>
        Esta organización todavía no tiene entrenadores activos. Invita a uno desde Equipo para
        poder asignarlo.
      </p>
    )
  }

  return (
    <form
      data-relationship-assign
      onSubmit={(event) => {
        event.preventDefault()
        if (membershipId) assign.mutate(membershipId)
      }}
    >
      <Field>
        <FieldLabel htmlFor={fieldId}>Profesional responsable</FieldLabel>
        <Select
          value={membershipId}
          onValueChange={(value) => setMembershipId(value ?? '')}
          items={options}
        >
          <SelectTrigger id={fieldId} data-studio-select-trigger disabled={loadingCoaches}>
            <SelectValue placeholder={loadingCoaches ? 'Cargando…' : 'Elige un entrenador'} />
          </SelectTrigger>
          <SelectContent align="start">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* The sentence the whole story turns on. Somebody assigning for the
            first time will reasonably assume it also gives access. */}
        <FieldDescription>
          Asignar no concede datos: el responsable seguirá sin ver nada de esta persona hasta que
          ella lo permita.
        </FieldDescription>
        {refusal === 'taken' ? <FieldError>{refusalDescription('taken')}</FieldError> : null}
      </Field>

      <div data-relationship-assign-actions>
        <Button type="submit" disabled={!membershipId || assign.isPending}>
          {assign.isPending ? 'Asignando…' : 'Asignar'}
        </Button>
        {assign.isPending ? <Spinner aria-label="Asignando al profesional" /> : null}
      </div>

      {refusal && refusal !== 'taken' ? (
        <Alert variant="danger" live="polite" data-relationship-assign-error>
          <AlertTitle>{refusalTitle(refusal)}</AlertTitle>
          <AlertDescription>{refusalDescription(refusal)}</AlertDescription>
          {refusal === 'unavailable' ? (
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => assign.mutate(membershipId)}>
                Reintentar
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}
    </form>
  )
}
