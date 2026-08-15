'use client'

import { Button } from '@allfitone/react/components/button'
import { useRef, useState, type ComponentProps } from 'react'

import { announceStudioLogout } from '@/lib/session-activity'
import { studioApi } from '@/lib/studio-api'

export function LogoutForm({
  variant = 'ghost',
  size = 'sm',
  disabled = false,
}: {
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  disabled?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, setPending] = useState(false)

  function submitLogout() {
    const form = formRef.current
    if (!form || pending) return
    setPending(true)
    announceStudioLogout('manual')
    form.submit()
  }

  return (
    <form
      ref={formRef}
      action={`${studioApi.apiUrl}/studio/v1/auth/logout`}
      method="post"
      onSubmit={(event) => {
        // Ending a session requires deliberate activation of the visible logout control.
        event.preventDefault()
      }}
    >
      <input type="hidden" name="reason" value="manual" />
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        onClick={submitLogout}
      >
        {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
      </Button>
    </form>
  )
}
