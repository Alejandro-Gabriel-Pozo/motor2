import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { crearCategoriaProducto, actualizarActivaCategoriaProducto, listarCategoriasProducto } from "@/server/actions/categorias-producto";

export default async function CategoriasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "categorias");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const categorias = await listarCategoriasProducto();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Categorías (rubro comercial — aplica a MP o PV)</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Activa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categorias.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-2">{c.nombre}</td>
              <td>{c.activo ? "Sí" : "No"}</td>
              <td>
                <form
                  action={async () => {
                    "use server";
                    await actualizarActivaCategoriaProducto(c.id, !c.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {c.activo ? "Desactivar" : "Activar"}
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
          await crearCategoriaProducto(String(formData.get("nombre") ?? ""));
        }}
        className="flex max-w-md gap-2"
      >
        <input name="nombre" placeholder="nombre de la categoría" required className="flex-1 rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </form>
    </div>
  );
}
