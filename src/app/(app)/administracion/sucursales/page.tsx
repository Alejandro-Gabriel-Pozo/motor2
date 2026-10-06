import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearSucursalConAdmin, actualizarActivoSucursal, renombrarSucursal, listarSucursales } from "@/server/actions/auth/sucursales";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function SucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // La pantalla se abre con `alta_sucursal`; cada control pide la clave de SU acción (una clave por acción): sin ella se ve la lista y no el botón.
  const [alta, activar, renombrar, sucursales] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_sucursal", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "activar_sucursal", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "renombrar_sucursal", ctx.db),
    listarSucursales(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Sucursales</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {sucursales.map((s) => (
            <tr key={s.id} className="border-b align-top">
              <td className="py-2">
                {renombrar.editar ? (
                  <FormConResultado
                    accion={async (formData: FormData) => {
                      "use server";
                      return renombrarSucursal(s.id, String(formData.get("nombre") ?? ""));
                    }}
                    className="flex gap-1"
                  >
                    <input name="nombre" aria-label={`Nombre de la sucursal "${s.nombre}"`} defaultValue={s.nombre} className="w-40 rounded border px-2 py-1" />
                    <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                      <IconoDeAccion id="editar" />
                      Renombrar
                    </button>
                  </FormConResultado>
                ) : (
                  s.nombre
                )}
              </td>
              <td>{s.activo ? "Sí" : "No"}</td>
              <td>
                {activar.editar && (
                  <ActivarDesactivarFila
                    activo={s.activo}
                    aviso={`¿Desactivar la sucursal "${s.nombre}"? Sus usuarios dejan de poder entrar a ella.`}
                    accion={async () => {
                      "use server";
                      return actualizarActivoSucursal(s.id, !s.activo);
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {alta.editar && (
      <FormConResultado
        accion={async (formData: FormData) => {
          "use server";
          return crearSucursalConAdmin({
            nombre: String(formData.get("nombre") ?? ""),
            emailPrimerAdmin: String(formData.get("emailPrimerAdmin") ?? ""),
          });
        }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Nueva sucursal</h2>
        <input name="nombre" placeholder="Nombre de la sucursal" required className="rounded border px-3 py-2" />
        <input
          name="emailPrimerAdmin"
          type="email"
          placeholder="Email del primer admin"
          required
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </FormConResultado>
      )}
    </div>
  );
}
