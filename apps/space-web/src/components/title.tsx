import type { ElementType } from 'react'

export type Tone = 'solid' | 'ghost' | 'cyan'

const TONE_CLASS: Record<Tone, string> = { solid: '', ghost: ' tone-ghost', cyan: ' tone-cyan' }

/** A big display title whose lines rise one after the other out of a mask. */
export function Title({
  as: Tag = 'h2',
  id,
  lines,
  tones = [],
  size = 'lg',
  reveal = true,
}: {
  as?: ElementType
  id?: string
  lines: readonly string[]
  tones?: readonly Tone[]
  size?: 'xl' | 'lg'
  reveal?: boolean
}) {
  return (
    <Tag id={id} className={`display display--${size}`} data-reveal={reveal ? 'mask' : undefined}>
      {lines.map((line, index) => (
        <span
          key={line}
          className={`line${TONE_CLASS[tones[index] ?? 'solid']}`}
          style={{ '--l': index }}
        >
          <span>{line}</span>
        </span>
      ))}
    </Tag>
  )
}
