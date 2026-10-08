'use client'

/**
 * Moving a client from one coach to another.
 *
 * A dialog rather than an inline control, because this is not the same shape of
 * action as putting the first coach in charge. It takes something away from
 * somebody, it reaches the person by email, and it cannot be undone from this
 * screen. A control that did all that from a dropdown in the page would be
 * asking for a mis-click.
 *
 * The three sentences under the title are the point of the dialog. An
 * administrator doing this to cover an absence will not guess that the client
 * gets an email, and will reasonably fear that changing the professional
 * changes what the gym can see. One of those needs warning about and the other
 * needs denying, so the dialog says both before it says anything else.
 */

import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@allfitone/react/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@allfitone/react/components/field'
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
  reassignRefusalDescription,
  reassignRefusalTitle,
  refusalFor,
  type AssignmentRefusal,
} from '@/lib/relationship-holder'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { OrganizationMembership } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function RelationshipHolderChange({
  organizationId,
  relationshipId,
  currentHolderName,
  coaches,
  loadingCoaches,
}: {
  organizationId: string
  relationshipId: string
  currentHolderName: string
  coaches: readonly OrganizationMembership[]
  loadingCoaches: boolean
}) {
  const fieldId = useId()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [membershipId, setMembershipId] = useState('')
  const [refusal, setRefusal] = useState<AssignmentRefusal | null>(null)

  const reassign = useMutation({
    mutationFn: (chosen: string) =>
      studioApi.reassignRelationshipHolder(
        organizationId,
        relationshipId,
        { membership_id: chosen },
        newCommand(),
      ),
    onSuccess: async () => {
      setRefusal(null)
      setOpen(false)
      setMembershipId('')
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
  const nobodyElse = !loadingCoaches && options.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-flight would hide a request that is still going to land.
        if (reassign.isPending) return
        setOpen(next)
        if (!next) {
          setMembershipId('')
          setRefusal(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" data-relationship-change-holder />
        }
      >
        Cambiar
      </DialogTrigger>
      <DialogContent data-relationship-change-dialog>
        <DialogHeader>
          <DialogTitle>Cambiar el profesional responsable</DialogTitle>
          {/* "Los permisos que la persona concedió", not "sus permisos": read
              straight after the outgoing coach's name, "sus" pointed at him,
              and whose permissions these are is the whole point of the
              sentence. */}
          <DialogDescription>
            {currentHolderName} dejará de tener acceso de inmediato, y conservará lo que haya
            registrado. Los permisos que la persona concedió no cambian: el nuevo profesional verá
            exactamente lo mismo. <b>A la persona le llegará un correo</b> contándole el cambio.
          </DialogDescription>
        </DialogHeader>

        {nobodyElse ? (
          <p data-relationship-no-other-coaches>
            No hay otro entrenador activo en esta organización a quien pasarle el cliente. Invita a
            uno desde Equipo.
          </p>
        ) : (
          <Field>
            <FieldLabel htmlFor={fieldId}>Nuevo profesional responsable</FieldLabel>
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
            {/* The current holder is not in the list: choosing them would change
                nothing, notify nobody, and leave the reader wondering. */}
            <FieldDescription>
              Solo los entrenadores activos de esta organización, sin contar a quien la atiende
              ahora.
            </FieldDescription>
          </Field>
        )}

        {refusal ? (
          <Alert variant="danger" live="assertive" data-relationship-change-error>
            <AlertTitle>{reassignRefusalTitle(refusal)}</AlertTitle>
            <AlertDescription>{reassignRefusalDescription(refusal)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" disabled={reassign.isPending} />}
          >
            Cancelar
          </DialogClose>
          <Button
            type="button"
            disabled={!membershipId || reassign.isPending || nobodyElse}
            onClick={() => reassign.mutate(membershipId)}
          >
            {reassign.isPending ? <Spinner label="Cambiando el responsable" /> : null}
            {reassign.isPending ? 'Cambiando…' : 'Cambiar y avisar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
