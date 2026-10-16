'use client'

/**
 * Cutting a cover short.
 *
 * An `AlertDialog` and not a `Dialog`, which is the difference between "fill
 * this in" and "are you sure": there is nothing to choose here. The whole
 * question is whether to take somebody's access away right now, so the screen
 * asks it plainly and the confirm button is destructive.
 *
 * The sentence it leads with is the consequence, because the consequence is
 * immediate and invisible: the substitute stops reading this person's data the
 * instant this is pressed. Not at midnight, not when the cover's last day
 * arrives. Somebody who expects it to take effect "from tomorrow" would be
 * cutting access a week early without knowing.
 *
 * And it says what does *not* happen, because that is the other half of what a
 * reader is deciding: the coach in charge keeps the client, and what the
 * substitute wrote stays written. Ending a cover is not undoing it.
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
import { Spinner } from '@allfitone/react/components/spinner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  terminationRefusalDescription,
  terminationRefusalFor,
  terminationRefusalTitle,
  type TerminationRefusal,
} from '@/lib/relationship-substitution'
import { StudioApiError, newCommand, studioApi } from '@/lib/studio-api'
import { studioQueryKeys } from '@/lib/studio-query'

export function RelationshipSubstitutionEnd({
  organizationId,
  relationshipId,
  substitutionId,
  substituteName,
  holderName,
}: {
  organizationId: string
  relationshipId: string
  substitutionId: string
  substituteName: string
  holderName: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<TerminationRefusal | null>(null)

  const end = useMutation({
    mutationFn: () =>
      studioApi.endRelationshipSubstitution(
        organizationId,
        relationshipId,
        substitutionId,
        newCommand(),
      ),
    onSuccess: async () => {
      setOpen(false)
      setRefusal(null)
      await queryClient.invalidateQueries({
        queryKey: studioQueryKeys.relationship(organizationId, relationshipId),
      })
    },
    onError: (error) => {
      setRefusal(terminationRefusalFor(error instanceof StudioApiError ? error.status : undefined))
    },
  })

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-flight would hide a request that is still going to land,
        // and this one takes an access away.
        if (end.isPending) return
        setOpen(next)
        if (!next) setRefusal(null)
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-relationship-end-substitution
        onClick={() => setOpen(true)}
      >
        Terminar
      </Button>
      <AlertDialogContent data-relationship-substitution-end-dialog>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Terminar esta suplencia?</AlertDialogTitle>
          <AlertDialogDescription>
            <b>{substituteName} dejará de ver los datos de esta persona ahora mismo</b>, no el día
            que terminaba. {holderName} sigue a cargo y lo que {substituteName} haya registrado se
            conserva.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {refusal ? (
          <Alert variant="danger" live="assertive" data-relationship-substitution-end-error>
            <AlertTitle>{terminationRefusalTitle(refusal)}</AlertTitle>
            <AlertDescription>{terminationRefusalDescription(refusal)}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          {/* «Conservar la suplencia», como el diálogo de revocar una
              invitación dice «Conservar invitación»: el botón nombra lo que se
              queda, no una acción que el lector tenga que interpretar. */}
          <AlertDialogCancel disabled={end.isPending}>Conservar la suplencia</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={end.isPending}
            onClick={(event) => {
              event.preventDefault()
              setRefusal(null)
              end.mutate()
            }}
          >
            {end.isPending ? <Spinner label="Terminando la suplencia" /> : null}
            {end.isPending ? 'Terminando…' : 'Terminar ahora'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
