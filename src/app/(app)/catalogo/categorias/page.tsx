import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { crearCategoriaProducto, actualizarActivaCategoriaProducto, listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function CategoriasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "categorias", ctx.db);
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
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-2">{c.nombre}</td>
              <td>{c.activo ? "Sí" : "No"}</td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivaCategoriaProducto(c.id, !c.activo);
                  }}
                >
                  <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                    <IconoDeAccion id="activar" />
                    {c.activo ? "Desactivar" : "Activar"}
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
          const r = await crearCategoriaProducto(String(formData.get("nombre") ?? ""));
          // El refresco se pide ACÁ y no en la acción: la acción también la usa el alta rápida del formulario de Producto (ver refrescar.ts).
          // Solo si salió bien: con un error no cambió nada y no hay nada que redibujar.
          if (r.ok) refrescarVistaSiHaceFalta();
          return r;
        }}
        className="max-w-md space-y-1"
      >
        <div className="flex gap-2">
          <input name="nombre" placeholder="nombre de la categoría" required className="flex-1 rounded border px-3 py-2" />
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Crear
          </button>
        </div>
      </FormConResultado>
    </div>
  );
}
