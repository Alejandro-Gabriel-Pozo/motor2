/**
 * Pantalla a la que se llega cuando el rol del usuario no tiene ninguna pantalla habilitada en la sucursal activa
 * (ver `pantallaDeInicio`). Sin esto, esa persona aterrizaría en un mensaje de «no tenés permiso» de alguna página.
 */
export default function InicioPage() {
  return (
    <div className="max-w-md space-y-2">
      <h1 className="text-xl font-semibold">Todavía no tenés pantallas habilitadas</h1>
      <p className="text-sm text-neutral-500">
        Tu rol no tiene permiso para ver ninguna sección en esta sucursal. Pedile a un admin que te lo habilite desde Administración → Permisos.
      </p>
    </div>
  );
}
