import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import {
  crearUnidad,
  actualizarActivaUnidad,
  actualizarDecimalesUnidad,
  listarUnidadesParaPanel,
  detectarInsumosConUnidadMezclada,
} from "@/server/actions/catalogo/unidades";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function UnidadesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "unidades");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [unidades, mezclados] = await Promise.all([listarUnidadesParaPanel(), detectarInsumosConUnidadMezclada()]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Unidades de medida</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Nombre</th>
            <th>Magnitud</th>
            <th>Decimales</th>
            <th>Activa</th>
            <th><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {unidades.map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2">{u.nombre}</td>
              <td>{u.magnitud}</td>
              <td>
                <FormConResultado
                  accion={async (formData: FormData) => {
                    "use server";
                    return actualizarDecimalesUnidad(u.id, Number(formData.get("decimales")));
                  }}
                  className="space-y-1"
                >
                  <div className="flex items-center gap-1">
                    <input name="decimales" type="number" aria-label={`Decimales de ${u.nombre}`} min={0} max={6} defaultValue={u.decimales} className="w-16 rounded border px-2 py-1" />
                    <button type="submit" className="text-sm underline">
                      Guardar
                    </button>
                  </div>
                </FormConResultado>
              </td>
              <td>{u.activa ? "Sí" : "No"}</td>
              <td>
                <FormConResultado
                  accion={async () => {
                    "use server";
                    return actualizarActivaUnidad(u.id, !u.activa);
                  }}
                >
                  <button type="submit" className="text-sm underline">
                    {u.activa ? "Desactivar" : "Activar"}
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
          return crearUnidad({
            nombre: String(formData.get("nombre") ?? ""),
            magnitud: formData.get("magnitud") as "PESO" | "VOLUMEN" | "CANTIDAD",
          });
        }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-medium">Nueva unidad</h2>
        <input name="nombre" placeholder="nombre (ej. kg)" required className="rounded border px-3 py-2" />
        <select name="magnitud" aria-label="Magnitud" required className="rounded border px-3 py-2">
          <option value="PESO">Peso</option>
          <option value="VOLUMEN">Volumen</option>
          <option value="CANTIDAD">Cantidad</option>
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Crear
        </button>
      </FormConResultado>

      {mezclados.ok && mezclados.datos.length > 0 && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <h2 className="mb-2 font-medium">Insumos con unidad de stock mezclada</h2>
          <ul className="list-disc pl-5">
            {mezclados.datos.map((m) => (
              <li key={m.insumo}>
                {m.insumo}: {m.unidades.join(", ")} ({m.cantidadProductos} productos)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
