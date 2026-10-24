'use client'

/**
 * What a register says while its cards are loading, empty, or refusing.
 *
 * The table presentation already answers this: the Design System's `TableState`
 * marks an error as an alert, an empty result as a polite status, and draws a
 * spinner while it waits. The card presentation reached for `Empty`, which is a
 * plain `div` carrying neither — so a person using a screen reader on a phone
 * was told nothing at all when a load failed, and nothing moved on screen while
 * one ran. The two presentations show the same register; narrowing the window
 * should not make the product quieter.
 *
 * So this carries `TableState`'s semantics across rather than inventing others,
 * and takes its prop types from the same source so the two cannot drift apart.
 * Loading deliberately gets no role and no live region, exactly as the table
 * does: the wrapper's `aria-busy` already says the register is working, and a
 * second announcement on every refetch would talk over the reader.
 */
import type { TableStateProps } from '@allfitone/react/components/table'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyTitle,
} from '@allfitone/react/components/empty'
import { Spinner } from '@allfitone/react/components/spinner'

type RegisterCardStateProps = Pick<TableStateProps, 'state' | 'title' | 'description' | 'action'>

export function RegisterCardState({ state, title, description, action }: RegisterCardStateProps) {
  const loading = state === 'loading'
  return (
    <Empty
      data-register-card-state
      data-state={state}
      role={state === 'error' ? 'alert' : loading ? undefined : 'status'}
      aria-live={loading ? undefined : 'polite'}
    >
      {loading ? <Spinner label={title} /> : null}
      <EmptyTitle>{title}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
