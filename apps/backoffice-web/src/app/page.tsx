export default function HomePage() {
  return (
    <main>
      <nav aria-label="Navegación principal">
        <a className="brand" href="/" aria-label="Allfit Backoffice, inicio">
          allfit<span>one</span>
        </a>
        <span className="surface">Backoffice</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">Operación interna</p>
        <h1>Control y soporte para todo Allfit One.</h1>
        <p className="summary">
          El punto de entrada del equipo interno para operar la plataforma con permisos explícitos,
          trazabilidad y protección de los datos sensibles.
        </p>
        <div className="notice" role="status">
          <span className="noticeDot" aria-hidden="true" />
          El acceso se habilitará cuando el flujo de MFA esté conectado.
        </div>
      </section>

      <footer>
        <span>Allfit Backoffice</span>
        <span>Acceso exclusivo para el equipo autorizado</span>
      </footer>
    </main>
  )
}
