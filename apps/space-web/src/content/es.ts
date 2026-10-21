/**
 * Spanish copy for the Space landing and its legal drafts.
 *
 * This is the shape every other language must match: `Dictionary` is derived
 * from it, so a missing or extra key in English is a type error, and the unit
 * test also rejects empty strings.
 */

export const es = {
  meta: {
    title: 'Allfit Space · Entrena con plan, no con suerte',
    description:
      'Tu programa, cada serie y lo que comes, en una sola app. Y tu historial viaja contigo: tus datos son tuyos.',
    privacyTitle: 'Política de tratamiento de datos · Allfit Space',
    termsTitle: 'Términos y condiciones · Allfit Space',
  },
  nav: {
    skip: 'Saltar al contenido',
    label: 'Principal',
    features: 'La app',
    programs: 'Programas',
    privacy: 'Privacidad',
    gyms: 'Gimnasios',
    language: 'Idioma',
    home: 'Allfit Space, inicio',
  },
  stores: {
    soon: 'Próximamente en',
    appStore: 'App Store',
    googlePlay: 'Google Play',
    download: 'Descárgala en',
  },
  hero: {
    lines: ['ENTRENA', 'CON PLAN.', 'NO CON SUERTE.'],
    lead: 'Tu programa, cada serie y lo que comes, en una sola app. Y tu historial viaja contigo.',
    todayAlt: 'Pantalla Hoy de Allfit Space: la sesión de Tirón del día y el resumen de la semana.',
    programAlt:
      'Detalle del programa Torso y pierna: 10 semanas, 4 días por semana y sus sesiones.',
    scroll: 'Desliza',
  },
  ticker: ['Fuerza', 'Hipertrofia', 'Carrera', 'Nutrición', 'Récords', 'Constancia'],
  features: {
    title: ['DEL PRIMER SET', 'AL ÚLTIMO BOCADO.'],
    cards: [
      {
        title: 'TU SEMANA, A LA VISTA',
        text: 'Qué toca hoy, cuánto llevas esta semana y todo lo que ya entrenaste.',
        alt: 'Pantalla Hoy con el resumen semanal y el historial de sesiones.',
      },
      {
        title: 'CADA SERIE CUENTA',
        text: 'Ves lo que levantaste la vez anterior y le ganas, serie por serie.',
        alt: 'Sesión en curso con las series de dominadas y el peso anterior.',
      },
      {
        title: 'LO QUE COMES, CONTRA TU META',
        text: 'Calorías y macros del día frente a la meta que va con tu programa.',
        alt: 'Registro de comidas del día con calorías y macros frente a la meta.',
      },
    ],
  },
  programs: {
    title: ['UN PROGRAMA', 'PARA TU OBJETIVO.'],
    lead: 'Le cuentas qué quieres lograr y cuánto has entrenado, y la app te propone por dónde empezar. Fuerza, hipertrofia, carrera o volver a moverte.',
    suggested: 'Sugerido para ti',
    items: [
      { name: 'TORSO Y PIERNA', meta: '4 días · 10 semanas' },
      { name: 'FUERZA BÁSICA', meta: '3 días · 8 semanas' },
      { name: 'MEDIA MARATÓN', meta: '4 días · 12 semanas' },
      { name: 'EMPUJE · TIRÓN · PIERNA', meta: '5 días · 12 semanas' },
    ],
  },
  privacy: {
    title: ['TUS DATOS', 'SON TUYOS.'],
    lead: 'Tu gimnasio y tu entrenador ven solo lo que tú aceptes, categoría por categoría. Y se lo quitas cuando quieras, sin perder nada tuyo.',
    alt: 'Pantalla Lo que compartes: cada gimnasio con las categorías que puede ver.',
    pillars: [
      {
        title: 'Nada se comparte solo',
        text: 'Aceptar a un gimnasio no comparte ningún dato. Eliges qué ve, categoría por categoría.',
      },
      {
        title: 'Lo cortas cuando quieras',
        text: 'Quitas un permiso y dejan de verlo al instante. Tus datos se quedan contigo.',
      },
      {
        title: 'Te vas con todo',
        text: 'Si dejas un gimnasio, tu historial se queda contigo y sigues entrenando sin perder nada.',
      },
    ],
  },
  records: {
    title: ['CADA', 'RÉCORD', 'SE CUENTA.'],
    lead: 'Terminas el entreno y la app ya tiene tu tarjeta lista: tu récord, los músculos que trabajaste o tu propia foto. A un toque de tus historias.',
    steps: [
      { verb: 'TERMINAS', text: 'La tarjeta se arma con tus datos reales.' },
      { verb: 'ELIGES', text: 'Músculos, récord o tu foto de fondo.' },
      { verb: 'PUBLICAS', text: 'Directo a tus historias, sin capturas.' },
    ],
    cards: [
      'Tarjeta de músculos: dorsales y espalda superior, trabajados en la sesión de Tirón.',
      'Tarjeta de récord personal: 35 kg en dominadas, 2,5 kg más que la vez anterior.',
      'Tarjeta de entreno completado con foto: sesión de Tirón, 26:05 y 1.920 kg en total.',
    ],
    editor: {
      label: 'Vista previa de una historia lista para publicar',
      caption: 'Añade un pie de foto…',
      story: 'Tu historia',
      friends: 'Amigos',
      published: 'Compartida en tu historia',
    },
    background: 'Atleta revisando su celular en el gimnasio después de entrenar.',
  },
  pro: {
    eyebrow: 'ALLFIT PRO',
    title: ['ALLFIT PRO,', 'INCLUIDO CON', 'TU GIMNASIO.'],
    text: 'La app es gratis. Allfit Pro te da programas ilimitados y todo tu progreso en detalle. Si tu gimnasio usa Allfit, Pro te sale incluido mientras sigas con ellos.',
    alt: 'Atleta con audífonos concentrado antes de entrenar en el gimnasio.',
  },
  studio: {
    title: '¿Tienes un gimnasio o entrenas a otros?',
    text: 'Invita a tus clientes, asígnales su programa y acompáñalos desde Allfit Studio.',
    cta: 'Conocer Allfit Studio',
  },
  closing: {
    title: ['TU PRÓXIMO RÉCORD', 'EMPIEZA HOY.'],
  },
  nvidia: {
    member: 'Allfit One es miembro de NVIDIA Inception.',
    trademark:
      '© 2026 NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.',
    alt: 'NVIDIA Inception Program',
  },
  footer: {
    terms: 'Términos',
    privacy: 'Privacidad',
    studio: 'Allfit Studio',
    one: 'Allfit One',
    rights: '© 2026 Allfit One',
    newWindow: 'Se abre en una pestaña nueva.',
  },
  legal: {
    draft: 'Versión preliminar',
    draftNote:
      'Este texto es un borrador en revisión legal. Puede cambiar antes del lanzamiento de la app.',
    updated: 'Última actualización: 20 de octubre de 2026',
    back: 'Volver a Allfit Space',
    pending: '[Pendiente de confirmar]',
    privacy: {
      title: 'Política de tratamiento de datos personales',
      sections: [
        {
          heading: '1. Quién es responsable',
          body: [
            'El responsable del tratamiento de tus datos en Allfit Space es [Pendiente de confirmar: razón social y NIT], con domicilio en [Pendiente de confirmar], Colombia.',
            'Para cualquier consulta o reclamo sobre tus datos escríbenos a [Pendiente de confirmar: correo de privacidad].',
            'Esta política sigue la Ley 1581 de 2012 y el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015).',
          ],
        },
        {
          heading: '2. Qué datos tratamos',
          body: [
            'Datos de identificación y contacto: nombre, apellido, correo y, si lo das, tu celular.',
            'Datos de entrenamiento: programas, sesiones, series, cargas, tiempos y récords.',
            'Datos de nutrición no clínica: comidas, alimentos, nutrientes y, si las subes, fotos de tus comidas.',
            'Datos de progreso corporal y contexto de salud, solo si decides registrarlos. Son datos sensibles: darlos es opcional y nunca condiciona el uso de la app.',
          ],
        },
        {
          heading: '3. Para qué los usamos',
          body: [
            'Para prestarte el servicio: guardar tu historial, mostrarte tu progreso y proponerte programas.',
            'Para compartir con un gimnasio o entrenador exactamente las categorías que tú autorices, y solo mientras las autorices.',
            'Para la seguridad de tu cuenta, el soporte y el cumplimiento de obligaciones legales.',
            'No vendemos tus datos ni los usamos para publicidad de terceros.',
          ],
        },
        {
          heading: '4. Lo que compartes con tu gimnasio',
          body: [
            'Aceptar a un gimnasio no comparte ningún dato por sí solo. Tú eliges qué categorías ve, una por una.',
            'Puedes retirar cualquier permiso en cualquier momento desde la app. Desde ese instante dejan de verlo, y lo demás que compartes no cambia.',
            'Si terminas la relación con un gimnasio, tu historial sigue siendo tuyo y sigue en tu cuenta.',
          ],
        },
        {
          heading: '5. Tus derechos',
          body: [
            'Conocer, actualizar y rectificar tus datos; pedir prueba de la autorización; saber cómo se han usado; revocar la autorización o pedir la supresión cuando no exista un deber legal de conservarlos; y presentar quejas ante la Superintendencia de Industria y Comercio.',
            'Las consultas se responden en un máximo de diez días hábiles y los reclamos en un máximo de quince días hábiles, en los términos de la ley.',
          ],
        },
        {
          heading: '6. Seguridad, conservación y transferencias',
          body: [
            'Protegemos tus datos con controles técnicos y organizativos, y cada acceso autorizado a ellos queda registrado.',
            'Usamos proveedores de infraestructura en la nube que pueden alojar datos fuera de Colombia, con garantías adecuadas de protección.',
            'Conservamos tus datos mientras tengas una cuenta activa y durante los plazos que exija la ley.',
          ],
        },
        {
          heading: '7. Edad mínima',
          body: ['Allfit Space es solo para personas de 18 años o más.'],
        },
      ],
    },
    terms: {
      title: 'Términos y condiciones de uso',
      sections: [
        {
          heading: '1. Aceptación',
          body: [
            'Al crear una cuenta en Allfit Space aceptas estos términos. La cuenta se crea únicamente desde la app.',
            'El servicio lo presta [Pendiente de confirmar: razón social y NIT].',
          ],
        },
        {
          heading: '2. Quién puede usarla',
          body: [
            'Debes tener 18 años o más y dar información verdadera. Tu cuenta es personal y eres responsable de su uso.',
          ],
        },
        {
          heading: '3. El servicio',
          body: [
            'Allfit Space te permite seguir programas de entrenamiento, registrar tus sesiones y tu nutrición no clínica, y compartir lo que elijas con tu gimnasio o entrenador.',
            'La app no ofrece consejo médico ni nutricional clínico. Consulta a un profesional de la salud antes de empezar un programa si tienes cualquier condición médica.',
          ],
        },
        {
          heading: '4. Gimnasios y entrenadores',
          body: [
            'Los gimnasios y entrenadores que usan Allfit Studio son independientes de Allfit. Su servicio y sus cobros se rigen por lo que acuerdes con ellos.',
            'Allfit no recibe ni maneja el dinero que le pagas a tu gimnasio.',
          ],
        },
        {
          heading: '5. Allfit Pro',
          body: [
            'La app es gratis. Allfit Pro es una suscripción opcional que se compra en la App Store o en Google Play, con sus condiciones de pago y cancelación.',
            'Si tu gimnasio usa Allfit, Pro te sale incluido mientras sigas activo con ellos. Si Pro termina, conservas todo tu historial.',
          ],
        },
        {
          heading: '6. Uso aceptable',
          body: [
            'No uses la app para fines ilícitos, para acceder a cuentas ajenas ni para afectar su funcionamiento.',
          ],
        },
        {
          heading: '7. Responsabilidad',
          body: [
            'Entrenar implica riesgos físicos que asumes al seguir un programa. Allfit responde en los términos de la ley colombiana aplicable.',
          ],
        },
        {
          heading: '8. Cambios y ley aplicable',
          body: [
            'Si cambiamos estos términos te avisaremos en la app antes de que entren en vigor.',
            'Estos términos se rigen por las leyes de la República de Colombia.',
          ],
        },
      ],
    },
  },
}

export type Dictionary = typeof es
