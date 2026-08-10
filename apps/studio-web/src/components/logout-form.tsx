'use client'

import { Button } from '@allfitone/react/components/button'
import type { ComponentProps } from 'react'

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
  return (
    <form
      action={`${studioApi.apiUrl}/studio/v1/auth/logout`}
      method="post"
      onSubmit={announceStudioLogout}
    >
      <input type="hidden" name="reason" value="manual" />
      <Button type="submit" variant={variant} size={size} disabled={disabled}>
        {'Cerrar sesi\u00f3n'}
      </Button>
    </form>
  )
}
