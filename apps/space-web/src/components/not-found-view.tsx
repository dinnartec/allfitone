import { ProductWordmark } from '@allfitone/react/brand'
import { buttonVariants } from '@allfitone/react/components/button'

import { content, languages } from '@/lib/content'

/**
 * A 404 can be reached without a language in the URL, so it speaks both and
 * offers a way back into each.
 */
export function NotFoundView(): React.JSX.Element {
  return (
    <div data-space-page>
      <main data-space-not-found>
        <ProductWordmark
          product="space"
          surface="dark"
          title="Allfit Space"
          width={150}
          height={30}
        />
        <div data-space-not-found-copy>
          <h1 lang="es" data-space-not-found-title>
            {content.es.notFound.title}
          </h1>
          <p lang="en" data-space-not-found-title>
            {content.en.notFound.title}
          </p>
        </div>
        <div data-space-actions>
          {languages.map((language, index) => (
            <a
              key={language}
              lang={language}
              data-slot="button"
              data-variant={index === 0 ? 'default' : 'outline'}
              className={buttonVariants({
                variant: index === 0 ? 'default' : 'outline',
                size: 'lg',
              })}
              href={`/${language}`}
            >
              {content[language].notFound.action}
            </a>
          ))}
        </div>
      </main>
    </div>
  )
}
