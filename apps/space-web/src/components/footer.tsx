import { ExternalIcon } from '@allfitone/react/icons'
import Image from 'next/image'
import Link from 'next/link'

import type { Dictionary } from '@/content'
import type { Locale } from '@/lib/locale'

export function Footer({ locale, copy }: { locale: Locale; copy: Dictionary }) {
  return (
    <footer className="footer">
      <div className="wrap partner">
        <Image
          src="/partners/nvidia-inception-program-badge.svg"
          alt={copy.nvidia.alt}
          width={200}
          height={86}
        />
        <div>
          <p className="partner__member">{copy.nvidia.member}</p>
          <p className="partner__legal" lang="en">
            {copy.nvidia.trademark}
          </p>
        </div>
      </div>
      <div className="wrap footer__bar">
        <a href={`https://www.allfit.one/${locale}`} className="footer__parent">
          Allfit One
          <ExternalIcon size="sm" decorative />
        </a>
        <ul className="footer__links">
          <li>
            <Link href={`/${locale}/terms`}>{copy.footer.terms}</Link>
          </li>
          <li>
            <Link href={`/${locale}/privacy`}>{copy.footer.privacy}</Link>
          </li>
          <li>
            <a href={`https://studio.allfit.one/${locale}`} target="_blank" rel="noopener">
              {copy.footer.studio}
              <span className="sr-only"> {copy.footer.newWindow}</span>
            </a>
          </li>
        </ul>
      </div>
      <p className="wrap footer__meta">{copy.footer.rights}</p>
    </footer>
  )
}
