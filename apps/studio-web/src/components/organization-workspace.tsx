export function OrganizationWorkspace() {
  return (
    <>
      <section data-workspace-welcome>
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Workspace</p>
          <h2>Tu espacio está listo.</h2>
          <p>
            El contexto activo se aplicará a todos los módulos que abras desde esta organización.
          </p>
        </div>
      </section>

      <section data-workspace-status aria-labelledby="workspace-status-title">
        <div>
          <span>01</span>
          <p>Identidad</p>
          <strong>Completada</strong>
        </div>
        <div>
          <span>02</span>
          <p>Espacio</p>
          <strong>Completado</strong>
        </div>
        <div data-current>
          <span>03</span>
          <p id="workspace-status-title">Listo</p>
          <strong>Workspace activo</strong>
        </div>
      </section>

      <section data-next-steps>
        <div data-studio-panel-intro>
          <p data-studio-eyebrow>Siguientes pasos</p>
          <h2>La base está preparada.</h2>
          <p>Estos módulos se habilitarán en los siguientes cortes del producto.</p>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Invitar al equipo</strong>
              <p>Membresías, roles y aceptación de invitaciones.</p>
            </div>
            <small>Próximamente</small>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Configurar la operación</strong>
              <p>Disciplinas, sedes y preferencias del espacio.</p>
            </div>
            <small>Próximamente</small>
          </li>
        </ol>
      </section>
    </>
  )
}
