import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearRol, actualizarActivoRol, listarRoles } from "@/server/actions/roles";

export default async function RolesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_permisos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const roles = await listarRoles();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Roles (catálogo único para todo el negocio)</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.nombre}</td>
              <td>{r.activo ? "Sí" : "No"}</td>
              <td>
                <form
                  action={async () => {
                    "use server";
                    await actualizarActivoRol(r.id, !r.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {r.activo ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        action={async (formData: FormData) => {
          "use server";
          await crearRol(String(formData.get("nombre") ?? ""));
        }}
        className="flex max-w-md gap-2"
      >
        <input name="nombre" placeholder="nombre del rol" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </form>
    </div>
  );
}
