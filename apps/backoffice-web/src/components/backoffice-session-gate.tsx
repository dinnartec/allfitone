'use client'

/**
 * The gate every authenticated Backoffice screen sits behind.
 *
 * It confirms the session before rendering the shell, and sends the operator
 * back to the access screen when it is gone. This is presentation, not
 * authorization: the API re-resolves the session and the duty on every request,
 * so a session that dies between renders fails the next call regardless of what
 * this component decided.
 */

import { Spinner } from '@allfitone/react/components/spinner'
import { useEffect, useState, type ReactNode } from 'react'

import { BackofficeWorkspaceShell } from './backoffice-workspace-shell'
import { backofficeApi, type BackofficeSession } from '@/lib/backoffice-api'

export function BackofficeSessionGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BackofficeSession | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    backofficeApi
      .session(controller.signal)
      .then(setSession)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        window.location.assign('/')
      })
    return () => {
      controller.abort()
    }
  }, [])

  if (!session) {
    return (
      <div data-backoffice-gate>
        <Spinner />
      </div>
    )
  }

  const operatorName = `${session.operator.given_name} ${session.operator.family_name}`.trim()
  return <BackofficeWorkspaceShell operatorName={operatorName}>{children}</BackofficeWorkspaceShell>
}
