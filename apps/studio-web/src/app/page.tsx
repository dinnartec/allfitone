import { StudioEntry } from '@/components/studio-entry'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string | string[] }>
}) {
  const { logout } = await searchParams
  return <StudioEntry logoutPartial={logout === 'partial'} />
}
