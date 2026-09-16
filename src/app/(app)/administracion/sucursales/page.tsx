import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearSucursalConAdmin, actualizarActivoSucursal, renombrarSucursal, listarSucursales } from "@/server/actions/sucursales";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function SucursalesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_sucursal");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sucursales = await listarSucursales();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Sucursales</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sucursales.map((s) => (
            <tr key={s.id} className="border-b align-top">
              <td className="py-2">
                <FormConResultado
                  accion={async (formData: FormData) => {
                    "use server";
                    return renombrarSucursal(s.id, String(formData.get("nombre") ?? ""));
                  }}
                  className="flex gap-1"
                >
                  <input name="nombre" defaultValue={s.nombre} className="w-40 rounded border px-2 py-1" />
                  <button type="submit" className="text-sm underline">
                    Renombrar
                  </button>
                </FormConResultado>
              </td>
              <td>{s.activo ? "Sí" : "No"}</td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivoSucursal(s.id, !s.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {s.activo ? "Desactivar" : "Activar"}
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
    </div>
  );
}
