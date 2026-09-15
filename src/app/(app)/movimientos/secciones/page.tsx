import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearSeccion, actualizarActivaSeccion, listarSeccionesParaPanel } from "@/server/actions/secciones";

export default async function SeccionesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "secciones");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const secciones = await listarSeccionesParaPanel(ctx.sucursalId);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Secciones (depósitos/ubicaciones de esta sucursal)</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {secciones.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="py-2">{s.nombre}</td>
              <td>{s.activa ? "Sí" : "No"}</td>
              <td>
                <form
                  action={async () => {
                    "use server";
                    await actualizarActivaSeccion(s.id, !s.activa);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {s.activa ? "Desactivar" : "Activar"}
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
          await crearSeccion(String(formData.get("nombre") ?? ""));
        }}
        className="flex max-w-md gap-2"
      >
        <input name="nombre" placeholder="nombre de la sección" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </form>
    </div>
  );
}
