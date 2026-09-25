import { LoadingCard } from '@/components/studio-frame'

/**
 * No chrome. This fallback sits above the workspace shell, so the setup frame it
 * used to borrow put an onboarding header at 72rem on screen for the length of a
 * route transition, and the workspace that replaced it has a sidebar and a
 * full-width header. Showing nothing is better than showing the wrong thing.
 */
export default function OrganizationLoading() {
  return <LoadingCard />
}
