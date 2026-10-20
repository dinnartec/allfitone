'use client'

/**
 * Ending a client's relationship with the gym.
 *
 * The heaviest thing this product lets an administrator do, and the dialog's
 * whole job is to make three things true in the reader's head before they press
 * anything. Each one is something they would otherwise assume wrongly, and each
 * wrong assumption costs somebody something different.
 *
 * **It happens now.** No notice, nothing scheduled. Somebody expecting "from
 * the end of the month" cuts a month of care today.
 *
 * **The gym keeps what it was already shown, stops being shown anything else,
 * and reading the kept part needs a justified case.** Ending is not deleting,
 * it is not continuing either, and "we keep it" without the third clause sounds
 * like "we can still look". One sentence carries all three, because a reader
 * facing four paragraphs reads none of them.
 *
 * And one thing it deliberately does **not** say: that the person will be told.
 * The command records the notice, but nothing renders it yet (`STUDIO-151`), so
 * no email leaves. Promising it here would be promising something the product
 * does not do.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@allfitone/react/components/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@allfitone/react/components/field'
import { Input } from '@allfitone/react/components/input'
import { Spinner } from '@allfitone/react/components/spinner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import {
  terminationReasonMessage,
  terminationReasonProblem,
  terminationRefusalDescription,
  terminationRefusalFor,
  terminationRefusalTitle,
  whatTerminationStopsSentence,
  type TerminationRefusal,
} from '@/lib/relationship-termination'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import type { RelationshipState } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function RelationshipTermination({
  organizationId,
  relationship,
  clientName,
}: {
  organizationId: string
  relationship: RelationshipState
  clientName: string
}) {
  const reasonFieldId = useId()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<'blank' | 'too-long' | null>(null)
  const [refusal, setRefusal] = useState<TerminationRefusal | null>(null)

  const stops = whatTerminationStopsSentence(relationship)

  const terminate = useMutation({
    mutationFn: (body: { reason?: string }) =>
      studioApi.terminateRelationship(
        organizationId,
        relationship.relationship_id,
        body,
        newCommand(),
      ),
    onSuccess: async () => {
      setOpen(false)
      setReason('')
      setRefusal(null)
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.relationship(organizationId, relationship.relationship_id),
      })
    },
    onError: (error) => {
      setRefusal(terminationRefusalFor(error instanceof StudioApiError ? error.status : undefined))
    },
  })

  const submit = () => {
    const found = terminationReasonProblem(reason)
    setProblem(found)
    if (found) return
    setRefusal(null)
    terminate.mutate(reason === '' ? {} : { reason })
  }

  return (
    <section data-relationship-termination>
      <h2 data-relationship-subheading>Terminar el vínculo</h2>
      {/* The sentence outside the dialog is the short one: enough to know
          whether to open it, not enough to decide. The deciding happens inside,
          where there is room to say what is kept and what stops. */}
      <p data-relationship-termination-lead>
        Cierra la atención a {clientName} y corta el acceso de inmediato. Lo que ya compartió se
        conserva como histórico.
      </p>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-flight would hide a request that is still going to land,
          // and this one cannot be undone from here.
          if (terminate.isPending) return
          setOpen(next)
          if (!next) {
            setReason('')
            setProblem(null)
            setRefusal(null)
          }
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-relationship-terminate
          onClick={() => setOpen(true)}
        >
          Terminar el vínculo
        </Button>

        <AlertDialogContent data-relationship-termination-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Terminar el vínculo con {clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              <b>Pasa ahora mismo, sin preaviso.</b>
              {stops ? ` ${stops}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* What is kept, what stops, and under what condition the kept part
              can be read — en una sola frase. Separarlas deja que cada mitad se
              lea mal por su lado, y alargarlas hace que no se lea ninguna. */}
          <p data-relationship-termination-kept>
            <b>Lo que ya compartió se conserva</b>, pero no veremos nada de lo que pase después.
            Para consultarlo hay que <b>abrir un caso justificado</b>.
          </p>

          <Field data-invalid={problem !== null}>
            <FieldLabel htmlFor={reasonFieldId}>Motivo (opcional)</FieldLabel>
            <Input
              id={reasonFieldId}
              value={reason}
              maxLength={2000}
              aria-invalid={problem !== null}
              onChange={(event) => {
                setReason(event.target.value)
                setProblem(null)
              }}
            />
            <FieldDescription>Queda en el historial.</FieldDescription>
            {problem ? (
              <FieldError data-relationship-termination-reason-error>
                {terminationReasonMessage(problem)}
              </FieldError>
            ) : null}
          </Field>

          {refusal ? (
            <Alert variant="danger" live="assertive" data-relationship-termination-error>
              <AlertTitle>{terminationRefusalTitle(refusal)}</AlertTitle>
              <AlertDescription>{terminationRefusalDescription(refusal)}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            {/* «Conservar el vínculo», like the sibling dialogs: the button
                names what stays rather than an action to interpret. */}
            <AlertDialogCancel disabled={terminate.isPending}>
              Conservar el vínculo
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={terminate.isPending}
              onClick={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              {terminate.isPending ? <Spinner label="Terminando el vínculo" /> : null}
              {terminate.isPending ? 'Terminando…' : 'Terminar ahora'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
