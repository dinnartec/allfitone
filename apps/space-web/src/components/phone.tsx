import Image from 'next/image'
import type { CSSProperties, ReactNode } from 'react'

/** A phone frame around a real capture of the app (1206 × 2622, iPhone 17 Pro). */
export function Phone({
  src,
  alt,
  priority = false,
  sizes = '320px',
  className,
  style,
  children,
}: {
  src?: string | undefined
  alt?: string | undefined
  priority?: boolean
  sizes?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div className={className ? `phone ${className}` : 'phone'} style={style}>
      <div className="phone__screen">
        {src && alt ? (
          <Image src={src} alt={alt} width={1206} height={2622} sizes={sizes} priority={priority} />
        ) : null}
        {children}
      </div>
    </div>
  )
}
