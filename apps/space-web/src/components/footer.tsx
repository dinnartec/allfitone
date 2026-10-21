import Image from 'next/image'
import Link from 'next/link'

import type { Dictionary } from '@/content'
import type { Locale } from '@/lib/locale'

export function Footer({ locale, copy }: { locale: Locale; copy: Dictionary }) {
  const outside = [
    { label: copy.footer.studio, href: `https://www.allfit.one/${locale}` },
    { label: copy.footer.one, href: `https://www.allfit.one/${locale}` },
  ]
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
        <Image
          src="/brand/allfit-space-lockup-on-dark.svg"
          alt="Allfit Space"
          width={123}
          height={30}
        />
        <ul className="footer__links">
          <li>
            <Link href={`/${locale}/terms`}>{copy.footer.terms}</Link>
          </li>
          <li>
            <Link href={`/${locale}/privacy`}>{copy.footer.privacy}</Link>
          </li>
          {outside.map((link) => (
            <li key={link.label}>
              <a href={link.href} target="_blank" rel="noopener">
                {link.label}
                <span className="sr-only"> {copy.footer.newWindow}</span>
              </a>
            </li>
          ))}
          <li>{copy.footer.rights}</li>
        </ul>
      </div>
    </footer>
  )
}
