'use client'

/**
 * Giving somebody on the team a role they do not have yet.
 *
 * The sentence under the picker is the reason this is a dialog and not a
 * dropdown. "Coach" sounds like it comes with clients, and an owner promoting
 * somebody will reasonably assume it does. It does not: a role lets a person
 * work in Studio, and access to anybody's data only ever comes from that
 * person, category by category. Nothing else on this screen says so.
 *
 * Owner is not offered. It is not a role this command can grant at all — the
 * server refuses it — because ownership moves through a transfer, which is a
 * different story with different consequences.
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

import { organizationRoleLabel } from '@/lib/team-directory'
import {
  grantableRoles,
  roleGrantRefusalDescription,
  roleGrantRefusalFor,
  roleGrantRefusalTitle,
  type AssignableRole,
  type RoleGrantRefusal,
} from '@/lib/team-roles'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { OrganizationMembership, OrganizationRoleCode } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function TeamRoleGrant({
  organizationId,
  membership,
}: {
  organizationId: string
  membership: OrganizationMembership
}) {
  const fieldId = useId()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('')
  const [refusal, setRefusal] = useState<RoleGrantRefusal | null>(null)

  const grant = useMutation({
    mutationFn: (chosen: AssignableRole) =>
      studioApi.grantMembershipRole(
        organizationId,
        membership.membership_id,
        { role_code: chosen },
        newCommand(),
      ),
    onSuccess: async () => {
      setRefusal(null)
      /*
       * Criterion 5: a permission change is never confirmed from a stale
       * picture. The list is re-read rather than patched, so what the next
       * reader acts on came from the server after the change, not from what
       * this screen believed before it.
       *
       * Re-read before closing, so the dialog is still showing its spinner
       * while the list updates rather than closing onto a stale table.
       */
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.organizationMembershipsRoot(organizationId),
      })
      setRole('')
      setOpen(false)
    },
    onError: (error) => {
      setRefusal(roleGrantRefusalFor(error instanceof StudioApiError ? error.status : undefined))
    },
  })

  const options = grantableRoles(membership).map((code) => ({
    value: code,
    label: organizationRoleLabel(code as OrganizationRoleCode),
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (grant.isPending) return
        setOpen(next)
        if (!next) {
          setRole('')
          setRefusal(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-team-grant-role
            aria-label={`Añadir un rol a ${membership.display_name}`}
          />
        }
      >
        Añadir rol
      </DialogTrigger>
      <DialogContent data-team-role-dialog>
        <DialogHeader>
          <DialogTitle>Añadir un rol a {membership.display_name}</DialogTitle>
          <DialogDescription>
            El rol pasa a estar activo de inmediato y no alcanza nada de lo ya ocurrido.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={fieldId}>Rol</FieldLabel>
          <Select value={role} onValueChange={(value) => setRole(value ?? '')} items={options}>
            <SelectTrigger id={fieldId} data-studio-select-trigger>
              <SelectValue placeholder="Elige un rol" />
            </SelectTrigger>
            <SelectContent align="start">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The sentence this dialog exists for. */}
          <FieldDescription>
            <b>Un rol no da acceso a los datos de nadie.</b> Habilita lo que la persona puede hacer
            en Studio; lo que puede ver de un cliente lo decide ese cliente, categoría por
            categoría. Propietario no está aquí: solo cambia con una transferencia.
          </FieldDescription>
        </Field>

        {refusal ? (
          <Alert variant="danger" live="assertive" data-team-role-error>
            <AlertTitle>{roleGrantRefusalTitle(refusal)}</AlertTitle>
            <AlertDescription>{roleGrantRefusalDescription(refusal)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" disabled={grant.isPending} />}>
            Cancelar
          </DialogClose>
          <Button
            type="button"
            disabled={!role || grant.isPending}
            onClick={() => grant.mutate(role as AssignableRole)}
          >
            {grant.isPending ? <Spinner label="Otorgando el rol" /> : null}
            {grant.isPending ? 'Otorgando…' : 'Otorgar rol'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
