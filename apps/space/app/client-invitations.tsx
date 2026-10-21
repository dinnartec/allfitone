/**
 * Where the emailed link lands: `allfitspace://client-invitations#token=…` (HU-SP-016).
 *
 * The token rides in the fragment and is held in memory, never put in a route or a URL
 * the API sees. The opening screen then decides as always — sign in, finish the
 * onboarding, or Hoy — and «Hoy» picks the held token up, because an invitation can
 * only be answered by a person whose Fitness ID already exists.
 */

import { useLinkingURL } from 'expo-linking'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

import { tokenFromLink } from '../src/client/gym-affiliation'
import { holdLinkToken } from '../src/client/invitation-draft'

export default function ClientInvitationLink() {
  const router = useRouter()
  const url = useLinkingURL()

  useEffect(() => {
    const token = tokenFromLink(url)
    if (token) holdLinkToken(token)
    router.replace('/')
  }, [router, url])

  return null
}
