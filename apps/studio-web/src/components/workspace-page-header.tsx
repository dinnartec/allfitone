/**
 * The single page-header composition for workspace routes.
 *
 * The page `h1` belongs to WorkspaceHeader in the shell, so pages never emit a
 * second one: they contribute the sentence that explains the view and, when
 * they have one, the primary action. Sibling screens that title themselves
 * differently are why the workspace stopped confirming where you are.
 */
import type { ReactNode } from 'react'

export function WorkspacePageHeader({
  description,
  actions,
}: {
  description: ReactNode
  actions?: ReactNode
}) {
  return (
    <header data-page-header>
      <p data-page-header-description>{description}</p>
      {actions ? <div data-page-header-actions>{actions}</div> : null}
    </header>
  )
}
