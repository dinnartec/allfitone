/**
 * The Space landing, in the order the story is told: what the app is (hero),
 * what using it looks like (from the first set to the last bite), where to
 * start (programmes), why it is safe (your data is yours), what you get to show
 * (every record counts), what it costs (Pro, included with your gym) and the
 * close. Every screen shown is a real capture of the app.
 */

import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Fragment } from 'react'

import { ExternalIcon, HistoryIcon, LockedIcon, PermissionsIcon } from '@allfitone/react/icons'

import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Phone } from '@/components/phone'
import { Records } from '@/components/records'
import { Stores } from '@/components/stores'
import { Title } from '@/components/title'
import { dictionaryFor } from '@/content'
import type { LocaleParams } from '@/lib/route'
import { isLocale } from '@/lib/locale'

const FEATURE_SCREENS = [
  '/images/screens/hoy-historial.webp',
  '/images/screens/sesion.webp',
  '/images/screens/comida.webp',
]

const PROGRAM_PHOTOS = [
  '/images/photos/program-upper-lower.webp',
  '/images/photos/program-strength.webp',
  '/images/photos/program-half-marathon.webp',
  '/images/photos/program-ppl.webp',
]

const PILLAR_ICONS = [LockedIcon, PermissionsIcon, HistoryIcon]

export default async function Landing({ params }: LocaleParams) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const copy = dictionaryFor(lang)

  return (
    <>
      <Header locale={lang} copy={copy.nav} />
      <main id="contenido">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__photo">
            <Image src="/images/photos/hero.webp" alt="" fill priority sizes="100vw" />
          </div>
          <div className="hero__veil" />
          <div className="wrap hero__grid">
            <div className="hero__copy">
              <h1 id="hero-title" className="display display--xl">
                {copy.hero.lines.map((line, index) => (
                  <span
                    key={line}
                    className={`line${index === 1 ? ' tone-ghost' : ''}`}
                    style={{ '--l': index }}
                  >
                    <span className={index === 2 ? 'sheen' : undefined}>{line}</span>
                  </span>
                ))}
              </h1>
              <p className="lead">{copy.hero.lead}</p>
              <Stores copy={copy.stores} />
            </div>
            <div className="hero__phones" data-parallax="">
              <div className="hero__phone hero__phone--back">
                <Phone
                  src="/images/screens/programa.webp"
                  alt={copy.hero.programAlt}
                  priority
                  sizes="262px"
                />
              </div>
              <div className="hero__phone hero__phone--front">
                <Phone
                  src="/images/screens/hoy.webp"
                  alt={copy.hero.todayAlt}
                  priority
                  sizes="316px"
                />
              </div>
            </div>
          </div>
          <p className="hero__scroll" aria-hidden="true">
            {copy.hero.scroll}
          </p>
        </section>

        <div className="ticker" aria-hidden="true">
          <div className="ticker__track">
            {[0, 1].map((copyIndex) => (
              <div key={copyIndex} className="ticker__group">
                {copy.ticker.map((word) => (
                  <Fragment key={word}>
                    <span className="ticker__word">{word}</span>
                    <span className="ticker__dot" />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section id="app" className="section" aria-labelledby="features-title">
          <div className="wrap">
            <div className="section__head">
              <Title id="features-title" lines={copy.features.title} />
            </div>
            <div className="features__grid">
              {copy.features.cards.map((card, index) => (
                <article
                  key={card.title}
                  className="feature"
                  data-spotlight=""
                  data-reveal=""
                  style={{ '--i': index }}
                >
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                  <Phone
                    className="feature__phone"
                    src={FEATURE_SCREENS[index]}
                    alt={card.alt}
                    sizes="300px"
                  />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="programas" className="section" aria-labelledby="programs-title">
          <div className="wrap">
            <div className="section__head section__head--split">
              <Title id="programs-title" lines={copy.programs.title} />
              <p className="lead" data-reveal="">
                {copy.programs.lead}
              </p>
            </div>
            <ul
              className="programs__grid"
              role="list"
              tabIndex={0}
              aria-labelledby="programs-title"
            >
              {copy.programs.items.map((program, index) => (
                <li
                  key={program.name}
                  className="program"
                  data-reveal="card"
                  style={{ '--i': index }}
                >
                  <div className="program__photo">
                    {PROGRAM_PHOTOS[index] ? (
                      <Image
                        src={PROGRAM_PHOTOS[index]}
                        alt=""
                        fill
                        quality={88}
                        sizes="(max-width: 1080px) 72vw, 310px"
                      />
                    ) : null}
                  </div>
                  {index === 0 ? (
                    <span className="program__badge">{copy.programs.suggested}</span>
                  ) : null}
                  <h3>{program.name}</h3>
                  <p>{program.meta}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="privacidad" className="section" aria-labelledby="privacy-title">
          <div className="wrap">
            <div className="privacy__top">
              <div className="privacy__copy">
                <Title id="privacy-title" lines={copy.privacy.title} size="xl" />
                <p className="lead" data-reveal="">
                  {copy.privacy.lead}
                </p>
              </div>
              <div className="privacy__stage" data-reveal="">
                <Phone
                  className="privacy__phone"
                  src="/images/screens/sharing.webp"
                  alt={copy.privacy.alt}
                  sizes="320px"
                />
              </div>
            </div>
            <ul className="pillars" role="list">
              {copy.privacy.pillars.map((pillar, index) => {
                const Icon = PILLAR_ICONS[index] ?? LockedIcon
                return (
                  <li key={pillar.title} className="pillar" data-reveal="" style={{ '--i': index }}>
                    <span className="pillar__icon">
                      <Icon size="md" decorative />
                    </span>
                    <h3>{pillar.title}</h3>
                    <p>{pillar.text}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <Records copy={copy.records} />

        <section id="gimnasios" className="section" aria-labelledby="pro-title">
          <div className="wrap">
            <div className="pro" data-reveal="">
              <div className="pro__copy">
                <p className="eyebrow">{copy.pro.eyebrow}</p>
                <Title id="pro-title" lines={copy.pro.title} reveal={false} />
                <p className="lead">{copy.pro.text}</p>
              </div>
              <div className="pro__photo">
                <Image
                  src="/images/photos/pro.webp"
                  alt={copy.pro.alt}
                  fill
                  sizes="(max-width: 900px) 100vw, 648px"
                />
              </div>
            </div>
            <div className="studio" data-reveal="">
              <div>
                <h3>{copy.studio.title}</h3>
                <p>{copy.studio.text}</p>
              </div>
              <a
                className="pill-link"
                href={`https://www.allfit.one/${lang}`}
                target="_blank"
                rel="noopener"
              >
                {copy.studio.cta}
                <ExternalIcon size="sm" decorative />
                <span className="sr-only"> {copy.footer.newWindow}</span>
              </a>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div className="closing__photo">
            <Image src="/images/photos/closing.webp" alt="" fill sizes="100vw" />
          </div>
          <div className="wrap closing__inner">
            <Title id="closing-title" lines={copy.closing.title} />
            <div data-reveal="">
              <Stores copy={copy.stores} />
            </div>
          </div>
        </section>
      </main>
      <Footer locale={lang} copy={copy} />
    </>
  )
}
