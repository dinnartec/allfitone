'use client'

/**
 * Asking somebody to cover for a client's coach.
 *
 * A dialog, like changing the holder, and for the same reasons: it reaches the
 * person by email and it cannot be undone from this screen. But the sentence it
 * has to lead with is the opposite one. Changing the holder warns that
 * something already happened; this one has to say that **nothing has**.
 *
 * "Proponer suplencia" reads like it takes effect. It does not: the cover is
 * created pending, the professional named in it reads nothing of the person's
 * until the person accepts, and silence is never acceptance. An administrator
 * who assumes otherwise will think a client is covered when nobody is.
 *
 * The end date is required, and the refusal says why rather than only that the
 * field is empty. Access stops on that date by itself, with no job to run — a
 * cover with no end would keep granting access to somebody's data until a human
 * noticed. The reason is carried by the refusal alone, where it is needed, and
 * not also by a note under the field that every reader pays for.
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
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
  proposalRefusalDescription,
  proposalRefusalFor,
  proposalRefusalTitle,
  todayAsCalendarDay,
  windowProblem,
  windowProblemMessage,
  type ProposalRefusal,
  type WindowProblem,
} from '@/lib/relationship-substitution'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { OrganizationMembership } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function RelationshipSubstitutionPropose({
  organizationId,
  relationshipId,
  holderName,
  coaches,
  loadingCoaches,
}: {
  organizationId: string
  relationshipId: string
  holderName: string
  coaches: readonly OrganizationMembership[]
  loadingCoaches: boolean
}) {
  const coachFieldId = useId()
  const startFieldId = useId()
  const endFieldId = useId()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [membershipId, setMembershipId] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [problem, setProblem] = useState<WindowProblem | null>(null)
  const [refusal, setRefusal] = useState<ProposalRefusal | null>(null)

  const today = todayAsCalendarDay()

  const reset = () => {
    setMembershipId('')
    setStartsOn('')
    setEndsOn('')
    setProblem(null)
    setRefusal(null)
  }

  const propose = useMutation({
    mutationFn: (proposal: { membership_id: string; starts_on: string; ends_on: string }) =>
      studioApi.proposeRelationshipSubstitution(
        organizationId,
        relationshipId,
        proposal,
        newCommand(),
      ),
    onSuccess: async () => {
      setOpen(false)
      reset()
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.relationship(organizationId, relationshipId),
      })
    },
    onError: (error) => {
      setRefusal(proposalRefusalFor(error instanceof StudioApiError ? error.status : undefined))
    },
  })

  const options = coaches.map((coach) => ({
    value: coach.membership_id,
    label: coach.display_name,
  }))
  const nobodyElse = !loadingCoaches && options.length === 0

  const submit = () => {
    const found = windowProblem(startsOn, endsOn, today)
    setProblem(found)
    if (found) return
    setRefusal(null)
    propose.mutate({ membership_id: membershipId, starts_on: startsOn, ends_on: endsOn })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-flight would hide a request that is still going to land —
        // and this one asks somebody a question by email.
        if (propose.isPending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-relationship-propose-substitution
          />
        }
      >
        Proponer suplencia
      </DialogTrigger>
      <DialogContent data-relationship-substitution-dialog>
        <DialogHeader>
          <DialogTitle>Proponer una suplencia</DialogTitle>
          {/* The order matters. "Nothing happens yet" comes first, because the
              button the reader just pressed suggests the opposite. */}
          <DialogDescription>
            <b>No pasa nada hasta que la persona acepte.</b> Le llegará un correo preguntándole. Si
            acepta, verá lo mismo que {holderName}, y solo durante esos días.
          </DialogDescription>
        </DialogHeader>

        {nobodyElse ? (
          <p data-relationship-no-other-coaches>
            No hay otro entrenador activo en esta organización que pueda cubrir. Invita a uno desde
            Equipo.
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={coachFieldId}>Quién cubre</FieldLabel>
              <Select
                value={membershipId}
                onValueChange={(value) => setMembershipId(value ?? '')}
                items={options}
              >
                <SelectTrigger
                  id={coachFieldId}
                  data-studio-select-trigger
                  disabled={loadingCoaches}
                >
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
              {/* The holder is not in the list: covering yourself is not
                  covering, and the command refuses it. */}
              <FieldDescription>
                Solo los entrenadores activos de esta organización, sin contar a {holderName}.
              </FieldDescription>
            </Field>

            <div data-relationship-substitution-dates>
              <Field data-invalid={problem === 'missing-start'}>
                <FieldLabel htmlFor={startFieldId}>Desde</FieldLabel>
                <Input
                  id={startFieldId}
                  type="date"
                  value={startsOn}
                  min={today}
                  aria-invalid={problem === 'missing-start'}
                  onChange={(event) => {
                    setStartsOn(event.target.value)
                    setProblem(null)
                  }}
                />
              </Field>
              <Field
                data-invalid={
                  problem === 'missing-end' ||
                  problem === 'ends-before-start' ||
                  problem === 'ends-in-past'
                }
              >
                <FieldLabel htmlFor={endFieldId}>Hasta</FieldLabel>
                <Input
                  id={endFieldId}
                  type="date"
                  value={endsOn}
                  min={startsOn || today}
                  aria-invalid={
                    problem === 'missing-end' ||
                    problem === 'ends-before-start' ||
                    problem === 'ends-in-past'
                  }
                  onChange={(event) => {
                    setEndsOn(event.target.value)
                    setProblem(null)
                  }}
                />
              </Field>
            </div>

            {problem ? (
              <FieldError data-relationship-substitution-dates-error>
                {windowProblemMessage(problem)}
              </FieldError>
            ) : null}
          </>
        )}

        {refusal ? (
          <Alert variant="danger" live="assertive" data-relationship-substitution-error>
            <AlertTitle>{proposalRefusalTitle(refusal)}</AlertTitle>
            <AlertDescription>{proposalRefusalDescription(refusal)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" disabled={propose.isPending} />}
          >
            Cancelar
          </DialogClose>
          {/* "Proponer y preguntar", not "Proponer": there is no way to press
              it without knowing an email goes out. */}
          <Button
            type="button"
            disabled={!membershipId || propose.isPending || nobodyElse}
            onClick={submit}
          >
            {propose.isPending ? <Spinner label="Proponiendo la suplencia" /> : null}
            {propose.isPending ? 'Proponiendo…' : 'Proponer y preguntar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
