const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export default function HomePage() {
  return (
    <main>
      <nav aria-label="Navegación principal">
        <a className="brand" href="/" aria-label="Allfit Studio, inicio">
          allfit<span>one</span>
        </a>
        <span className="surface">Studio</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">Tu operación, mejor conectada</p>
        <h1>Haz que cada entrenamiento cuente.</h1>
        <p className="summary">
          Un espacio para que entrenadores, gimnasios y estudios acompañen a cada persona con
          contexto, claridad y continuidad.
        </p>
        <div className="actions">
          <a className="primary" href={`${apiUrl}/studio/v1/auth/start`}>
            Ingresar a Studio
          </a>
          <span>Acceso seguro alojado por el proveedor de identidad.</span>
        </div>
      </section>

      <footer>
        <span>Allfit Studio</span>
        <span>Una aplicación de allfit.one</span>
      </footer>
    </main>
  )
}
