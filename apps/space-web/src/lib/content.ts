/**
 * Copy for the Allfit Space landing, in Spanish (default) and English.
 *
 * Space is not publicly released. Every line here must read as product vision,
 * never as an available capability: PRODUCT.md in allfitone-landing-page owns
 * that rule, and this copy is taken from the Space section published there in
 * both languages so the two public sites never promise different things.
 */

export const languages = ['es', 'en'] as const
export type Language = (typeof languages)[number]

export function isLanguage(value: string): value is Language {
  return (languages as readonly string[]).includes(value)
}

/** Open Graph locale codes for each URL language. */
export const ogLocales: Record<Language, string> = { es: 'es_CO', en: 'en_US' }

export const siteUrl = 'https://space.allfit.one'
export const contactEmail = 'hello@allfit.one'

/** The main site is language-prefixed too, so links land on the same language. */
export function allfitOneUrl(language: Language): string {
  return `https://www.allfit.one/${language}`
}

const es = {
  metadata: {
    title: 'Allfit Space · Próximamente',
    description:
      'Allfit Space reúne tu plan, tus sesiones y tu progreso en un solo lugar. Entrena por tu cuenta o sigue la planificación de un profesional.',
  },
  selectLanguage: 'Seleccionar idioma',
  hero: {
    status: 'Próximamente',
    title: 'Sigue entrenando desde donde lo dejaste.',
    description:
      'Allfit Space reúne tu plan, tus sesiones y tu progreso en un solo lugar. Entrena por tu cuenta o sigue la planificación de un profesional.',
    primaryAction: 'Escríbenos',
    secondaryAction: 'Conoce Allfit One',
  },
  /** The two ways to train with Space, and the history that carries across both. */
  trainingModes: [
    {
      title: 'Entrena por tu cuenta',
      description:
        'Organiza tus sesiones y registra lo que haces cuando entrenas de forma independiente.',
    },
    {
      title: 'Sigue el plan de tu entrenador',
      description: 'Consulta su planificación en el mismo lugar donde registras cada sesión.',
    },
  ],
  continuity: {
    title: 'Tu historial sigue contigo',
    description:
      'Tu Fitness ID conserva tus marcas y tu progreso aunque cambies de gimnasio, profesional o disciplina.',
  },
  /**
   * Illustrative sessions for the hero. They show the idea of picking up where you
   * left off, using the main site's mockup vocabulary; they are not product data.
   */
  sessionLog: {
    label: 'Tu semana',
    past: [
      { day: 'Lun', title: 'Fuerza · Tren inferior', detail: '64 min' },
      { day: 'Mar', title: 'Carrera suave', detail: '6 km' },
      { day: 'Jue', title: 'Movilidad', detail: '30 min' },
    ],
    next: {
      day: 'Hoy',
      note: 'Tu siguiente paso',
      title: 'Fuerza · Tren superior',
      detail: '72 min',
    },
  },
  fitnessId: {
    label: 'Fitness ID',
    title: 'Tu información es tuya.',
    controls: [
      {
        title: 'Tú concedes',
        description:
          'Cada profesional u organización ve únicamente lo que autorizas, para una finalidad declarada.',
      },
      {
        title: 'Tú revocas',
        description: 'Retiras un acceso cuando quieras. Tu información no se va con él.',
      },
      {
        title: 'Tú te lo llevas',
        description: 'Si la relación termina, el historial sigue siendo tuyo.',
      },
    ],
    note: 'El Fitness ID es la tesis de producto de Allfit One. Todavía no es una función pública disponible.',
  },
  status: {
    label: 'Dónde estamos',
    title: 'En desarrollo',
    description:
      'Estamos construyendo Allfit Space. ¿Entrenas, acompañas a personas o gestionas un espacio fitness? Escríbenos y construyámoslo contigo.',
  },
  footer: {
    parent: 'Allfit Space es parte de Allfit One.',
    contact: 'Contacto',
  },
  notFound: {
    title: 'Página no encontrada.',
    action: 'Volver a Allfit Space',
  },
} as const

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer Item)[]
    ? readonly Widen<Item>[]
    : { readonly [Key in keyof T]: Widen<T[Key]> }

/** English mirrors the Spanish shape with any strings of its own. */
type Content = Widen<typeof es>

const en: Content = {
  metadata: {
    title: 'Allfit Space · Coming soon',
    description:
      "Allfit Space brings your plan, sessions and progress into one place. Train on your own or follow a professional's plan.",
  },
  selectLanguage: 'Select language',
  hero: {
    status: 'Coming soon',
    title: 'Keep training from where you left off.',
    description:
      "Allfit Space brings your plan, sessions and progress into one place. Train on your own or follow a professional's plan.",
    primaryAction: 'Get in touch',
    secondaryAction: 'Meet Allfit One',
  },
  trainingModes: [
    {
      title: 'Train on your own',
      description: 'Plan your sessions and log what you do when you train independently.',
    },
    {
      title: "Follow your coach's plan",
      description: 'Keep their plan in the same place where you log each session.',
    },
  ],
  continuity: {
    title: 'Your history stays with you',
    description:
      'Your Fitness ID keeps your records and progress when you change gym, coach or discipline.',
  },
  sessionLog: {
    label: 'Your week',
    past: [
      { day: 'Mon', title: 'Strength · Lower body', detail: '64 min' },
      { day: 'Tue', title: 'Easy run', detail: '6 km' },
      { day: 'Thu', title: 'Mobility', detail: '30 min' },
    ],
    next: {
      day: 'Today',
      note: 'Your next move',
      title: 'Strength · Upper body',
      detail: '72 min',
    },
  },
  fitnessId: {
    label: 'Fitness ID',
    title: 'Your information is yours.',
    controls: [
      {
        title: 'You grant',
        description:
          'Every professional or organization sees only what you authorize, for a declared purpose.',
      },
      {
        title: 'You revoke',
        description:
          'Withdraw an access whenever you want. Your information does not leave with it.',
      },
      {
        title: 'You keep it',
        description: 'If the relationship ends, the history is still yours.',
      },
    ],
    note: 'Fitness ID is the Allfit One product thesis. It is not a publicly available feature yet.',
  },
  status: {
    label: 'Where we are',
    title: 'In development',
    description:
      "We're building Allfit Space. Do you train, coach people or run a fitness space? Write to us and let's build it with you.",
  },
  footer: {
    parent: 'Allfit Space is part of Allfit One.',
    contact: 'Contact',
  },
  notFound: {
    title: 'Page not found.',
    action: 'Back to Allfit Space',
  },
}

export const content: Record<Language, Content> = { es, en }
