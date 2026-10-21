import { BrandLockup, ProductWordmark } from '@allfitone/react/brand'
import { buttonVariants } from '@allfitone/react/components/button'
import { ExternalIcon } from '@allfitone/react/icons'
import { notFound } from 'next/navigation'

import { LanguageSwitch } from '@/components/language-switch'
import { allfitOneUrl, contactEmail, content, isLanguage } from '@/lib/content'

const contactHref = `mailto:${contactEmail}?subject=${encodeURIComponent('Allfit Space')}`

export default async function SpaceLanding({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<React.JSX.Element> {
  const { lang } = await params
  if (!isLanguage(lang)) notFound()
  const { hero, trainingModes, continuity, sessionLog, fitnessId, status, footer } = content[lang]
  const parentSite = allfitOneUrl(lang)

  return (
    <div data-space-page>
      <header data-space-header>
        <span data-space-brand>
          <ProductWordmark
            product="space"
            surface="dark"
            title="Allfit Space"
            width={150}
            height={30}
          />
        </span>
        <div data-space-header-actions>
          <LanguageSwitch language={lang} label={content[lang].selectLanguage} />
          <span data-space-parent-link>
            <a
              data-slot="button"
              data-variant="ghost"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              href={parentSite}
            >
              Allfit One
              <ExternalIcon data-icon="inline-end" decorative />
            </a>
          </span>
        </div>
      </header>

      <main data-space-main>
        <section data-space-hero aria-labelledby="space-hero-title">
          <h1 id="space-hero-title" data-space-title>
            {hero.title}
          </h1>
          <div data-space-hero-copy>
            <p data-space-lead>{hero.description}</p>
            <div data-space-actions>
              <a
                data-slot="button"
                data-variant="default"
                className={buttonVariants({ size: 'lg' })}
                href={contactHref}
              >
                {hero.primaryAction}
              </a>
              <a
                data-slot="button"
                data-variant="outline"
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
                href={parentSite}
              >
                {hero.secondaryAction}
              </a>
            </div>
            <p data-space-status-line>{hero.status}</p>
          </div>

          {/* Illustration of the headline: past sessions lead into the next one. */}
          <figure data-space-log aria-hidden="true">
            <figcaption data-space-log-label>{sessionLog.label}</figcaption>
            <ol data-space-log-list>
              {sessionLog.past.map((session) => (
                <li key={session.day} data-space-log-row>
                  <span data-space-log-day>{session.day}</span>
                  <span data-space-log-title>{session.title}</span>
                  <span data-space-log-detail>{session.detail}</span>
                </li>
              ))}
              <li data-space-log-row data-space-log-next>
                <span data-space-log-day>{sessionLog.next.day}</span>
                <span data-space-log-title>
                  <span data-space-log-note>{sessionLog.next.note}</span>
                  {sessionLog.next.title}
                </span>
                <span data-space-log-detail>{sessionLog.next.detail}</span>
              </li>
            </ol>
          </figure>
        </section>

        <section data-space-modes>
          {trainingModes.map((mode) => (
            <article key={mode.title} data-space-mode>
              <h2 data-space-mode-title>{mode.title}</h2>
              <p data-space-body>{mode.description}</p>
            </article>
          ))}
          <article data-space-continuity>
            <h2 data-space-mode-title>{continuity.title}</h2>
            <p data-space-body>{continuity.description}</p>
          </article>
        </section>

        <section data-space-section aria-labelledby="space-fitness-id-title">
          <div data-space-section-heading>
            <p data-space-kicker>{fitnessId.label}</p>
            <h2 id="space-fitness-id-title" data-space-heading>
              {fitnessId.title}
            </h2>
          </div>
          <ul data-space-controls>
            {fitnessId.controls.map((control) => (
              <li key={control.title} data-space-control>
                <h3 data-space-control-title>{control.title}</h3>
                <p data-space-body>{control.description}</p>
              </li>
            ))}
          </ul>
          <p data-space-note>{fitnessId.note}</p>
        </section>

        <section data-space-closing aria-labelledby="space-status-title">
          <div data-space-section-heading>
            <p data-space-kicker>{status.label}</p>
            <h2 id="space-status-title" data-space-heading>
              {status.title}
            </h2>
          </div>
          <div data-space-closing-body>
            <p data-space-lead>{status.description}</p>
            <a
              data-slot="button"
              data-variant="default"
              className={buttonVariants({ size: 'lg' })}
              href={contactHref}
            >
              {hero.primaryAction}
            </a>
          </div>
        </section>
      </main>

      <footer data-space-footer>
        <a href={parentSite} data-space-footer-brand>
          <BrandLockup surface="dark" title="Allfit One" width={120} />
        </a>
        <p data-space-footer-text>{footer.parent}</p>
        <a href={contactHref} data-space-footer-link>
          {footer.contact} · {contactEmail}
        </a>
      </footer>
    </div>
  )
}
