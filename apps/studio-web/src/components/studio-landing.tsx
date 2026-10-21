'use client'

import { BrandLockup, ProductWordmark } from '@allfitone/react/brand'
import { Alert, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { AccessHeader, AccessShell } from '@allfitone/react/components/access-shell'
import { buttonVariants } from '@allfitone/react/components/button'
import { ForwardIcon, FoundationIcon, type IconName } from '@allfitone/react/icons'

import { prepareStudioAuthentication } from '@/lib/session-activity'
import { studioApi } from '@/lib/studio-api'

/**
 * What a signed-out visitor to studio.allfit.one sees first: what Studio is,
 * then the way in. Copy follows the Studio section of allfitone-landing-page,
 * so the public site and the product never describe Studio differently.
 *
 * Signing in and creating an account are one hosted flow: there is a single
 * `auth/start`, and a first visit continues into activation and space setup.
 */

const parentSiteUrl = 'https://www.allfit.one/es'

const principles = [
  {
    title: 'Cada persona entra con su identidad',
    description:
      'La relación comienza cuando acepta una invitación. Studio usa su Fitness ID y solo muestra los datos que decidió compartir.',
  },
  {
    title: 'Compara el plan con lo que ocurrió',
    description:
      'Studio conserva cada versión del programa y la compara con lo que la persona registró en sus sesiones.',
  },
  {
    title: 'Cada persona decide qué comparte',
    description:
      'El acceso depende de una relación, una autorización y una asignación vigentes. Ser dueño o administrador no basta.',
  },
  {
    title: 'Los cobros llegan a tu organización',
    description: 'Cada pago pasa por tu propia pasarela. Allfit no recibe ni retiene el dinero.',
  },
] as const

const modules: readonly { icon: IconName; name: string; description: string }[] = [
  {
    icon: 'people',
    name: 'Personas',
    description: 'Invitaciones, relaciones y seguimiento de clientes',
  },
  {
    icon: 'training',
    name: 'Entrenamiento',
    description: 'Plantillas, programas, asignaciones e historial de versiones',
  },
  {
    icon: 'progress',
    name: 'Progreso',
    description: 'Sesiones registradas, adherencia y resultados compartidos',
  },
  { icon: 'team', name: 'Equipo', description: 'Miembros, roles y permisos' },
  { icon: 'business', name: 'Planes', description: 'Planes que vendes y suscripciones activas' },
]

const upcoming = ['Agenda y reservas', 'Clases y cupos', 'Página pública', 'Marketplace'] as const

/** Illustrative only: one client's week, planned against logged. Not product data. */
const preview = {
  client: 'Laura Méndez',
  program: 'Fuerza · Programa v3 · Semana 4',
  shared: 'Comparte contigo su entrenamiento y su progreso.',
  columns: ['Ejercicio', 'Plan', 'Registró'],
  rows: [
    { exercise: 'Sentadilla trasera', planned: '4 × 6', logged: '4 × 6' },
    { exercise: 'Press de banca', planned: '4 × 8', logged: '3 × 8', change: 'Una serie menos' },
    {
      exercise: 'Remo con barra',
      planned: '3 × 10',
      logged: '3 × 12',
      change: 'Dos repeticiones más',
    },
    { exercise: 'Peso muerto rumano', planned: '3 × 8', logged: '3 × 8' },
  ],
} as const

export function StudioLanding({ logoutPartial }: { logoutPartial: boolean }) {
  const authStart = `${studioApi.apiUrl}/studio/v1/auth/start`

  return (
    <AccessShell>
      <AccessHeader>
        <ProductWordmark
          product="studio"
          surface="light"
          title="Allfit Studio"
          width={138}
          height={28}
        />
        {/* No link here: on a phone the first-visit consent panel opens over this
            corner, and the footer already leads to Allfit One. */}
      </AccessHeader>

      <main data-studio-landing>
        <section data-studio-landing-hero aria-labelledby="studio-landing-title">
          <div data-studio-landing-intro>
            {logoutPartial ? (
              <Alert variant="warning" live="polite">
                <AlertTitle>La sesión se cerró en este equipo</AlertTitle>
                <AlertDescription>
                  No pudimos confirmar todo el cierre remoto. Si vuelves a entrar, completa de nuevo
                  el acceso con el proveedor de identidad.
                </AlertDescription>
              </Alert>
            ) : null}
            <h1 id="studio-landing-title" data-studio-landing-title>
              Organiza tu negocio sin perder de vista a tus clientes.
            </h1>
            <p data-studio-landing-lead>
              Un solo panel para gestionar clientes, planificación, progreso y operación, conectado
              con el Fitness ID de cada persona.
            </p>
            <div data-studio-landing-actions>
              <a
                data-slot="button"
                data-variant="default"
                className={buttonVariants({ size: 'lg' })}
                href={authStart}
                onClick={prepareStudioAuthentication}
              >
                Entrar a Studio
                <ForwardIcon data-icon="inline-end" decorative />
              </a>
              <p data-studio-landing-note>
                ¿Es tu primera vez? Con este mismo acceso creas tu cuenta y configuras tu espacio.
              </p>
            </div>
          </div>

          {/* The plan-against-logged comparison is Studio's core idea, so it is the one picture here. */}
          <figure data-studio-landing-preview aria-hidden="true">
            <div data-studio-preview-head>
              <p data-studio-preview-client>{preview.client}</p>
              <p data-studio-preview-program>{preview.program}</p>
            </div>
            <p data-studio-preview-shared>
              <FoundationIcon name="permissions" decorative />
              {preview.shared}
            </p>
            <div data-studio-preview-grid>
              {preview.columns.map((column) => (
                <span key={column} data-studio-preview-column>
                  {column}
                </span>
              ))}
              {preview.rows.map((row) => (
                <div key={row.exercise} data-studio-preview-row>
                  <span data-studio-preview-exercise>
                    {row.exercise}
                    {'change' in row ? <span data-studio-preview-change>{row.change}</span> : null}
                  </span>
                  <span data-studio-preview-value>{row.planned}</span>
                  <span
                    data-studio-preview-value
                    data-changed={'change' in row ? 'true' : undefined}
                  >
                    {row.logged}
                  </span>
                </div>
              ))}
            </div>
          </figure>
        </section>

        <section data-studio-landing-section aria-labelledby="studio-landing-how">
          <h2 id="studio-landing-how" data-studio-landing-heading>
            Cómo funciona Studio
          </h2>
          <ul data-studio-landing-principles>
            {principles.map((principle) => (
              <li key={principle.title} data-studio-landing-principle>
                <h3 data-studio-landing-principle-title>{principle.title}</h3>
                <p data-studio-landing-body>{principle.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section data-studio-landing-section aria-labelledby="studio-landing-modules">
          <h2 id="studio-landing-modules" data-studio-landing-heading>
            Lo que gestionas desde Studio
          </h2>
          {/* Laid out like the workspace navigation these modules become once inside. */}
          <ul data-studio-landing-modules>
            {modules.map((module) => (
              <li key={module.name} data-studio-landing-module>
                <span data-studio-landing-module-icon>
                  <FoundationIcon name={module.icon} decorative />
                </span>
                <span data-studio-landing-module-name>{module.name}</span>
                <span data-studio-landing-body>{module.description}</span>
              </li>
            ))}
          </ul>
          <p data-studio-landing-upcoming>
            <span data-studio-landing-upcoming-label>Más adelante</span>
            {upcoming.join(', ')}.
          </p>
        </section>

        <section data-studio-landing-closing aria-labelledby="studio-landing-closing">
          <h2 id="studio-landing-closing" data-studio-landing-heading>
            Entra. El contexto ya está listo.
          </h2>
          <div data-studio-landing-closing-body>
            <p data-studio-landing-lead>
              Accede de forma segura para continuar con tus espacios, equipo y actividad.
            </p>
            <a
              data-slot="button"
              data-variant="outline"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
              href={authStart}
              onClick={prepareStudioAuthentication}
            >
              Crear cuenta o ingresar
            </a>
            <p data-studio-landing-note>
              El inicio de sesión se completa con el proveedor de identidad de Allfit One.
            </p>
          </div>
        </section>
      </main>

      <footer data-studio-landing-footer>
        <div data-studio-landing-footer-row>
          <a href={parentSiteUrl} data-studio-landing-footer-brand>
            <BrandLockup surface="light" title="Allfit One" width={112} />
          </a>
          <p data-studio-landing-body>Allfit Studio es parte de Allfit One.</p>
        </div>
      </footer>
    </AccessShell>
  )
}
