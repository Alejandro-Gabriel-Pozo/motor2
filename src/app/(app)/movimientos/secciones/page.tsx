import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearSeccion, actualizarActivaSeccion, actualizarRespaldoSeccion, renombrarSeccion, listarSeccionesParaPanel } from "@/server/actions/movimientos/secciones";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function SeccionesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "secciones", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const secciones = await listarSeccionesParaPanel(ctx.sucursalId);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Secciones (depósitos/ubicaciones de esta sucursal)</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Si una sección no sirve de respaldo, las ventas del salón solo la usan cuando es la sección habitual de un producto.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activa</th>
            <th>Respaldo automático en ventas</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {secciones.map((s) => (
            <tr key={s.id} className="border-b align-top">
              <td className="py-2">
                <FormConResultado
                  accion={async (formData: FormData) => {
                    "use server";
                    return renombrarSeccion(s.id, String(formData.get("nombre") ?? ""));
                  }}
                  className="flex gap-1"
                >
                  <input name="nombre" defaultValue={s.nombre} className="w-40 rounded border px-2 py-1" />
                  <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                    <IconoDeAccion id="editar" />
                    Renombrar
                  </button>
                </FormConResultado>
              </td>
              <td>{s.activa ? "Sí" : "No"}</td>
              <td>
                {/* Sí/No y su botón en la MISMA celda (el flex va en el form, no en el <td>): la celda «Activa» sigue siendo la única que dice solo «Sí»/«No». */}
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarRespaldoSeccion(s.id, !s.sirveDeRespaldoEnVentas);
                  }}
                  className="flex items-baseline gap-2"
                >
                  <span>{s.sirveDeRespaldoEnVentas ? "Sí" : "No"}</span>
                  <button type="submit" className="text-sm underline">
                    {s.sirveDeRespaldoEnVentas ? "Quitar del respaldo" : "Usar de respaldo"}
                  </button>
                </FormConResultado>
              </td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivaSeccion(s.id, !s.activa);
                  }}
                >
                  <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                    <IconoDeAccion id="activar" />
                    {s.activa ? "Desactivar" : "Activar"}
                  </button>
                </FormConResultado>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <FormConResultado
        accion={async (formData: FormData) => {
          "use server";
          return crearSeccion(String(formData.get("nombre") ?? ""));
        }}
        className="flex max-w-md gap-2"
      >
        <input name="nombre" placeholder="nombre de la sección" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </FormConResultado>
    </div>
  );
}
