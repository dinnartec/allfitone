import { OrganizationWorkspace } from '@/components/organization-workspace'

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  return <OrganizationWorkspace organizationId={organizationId} />
}
