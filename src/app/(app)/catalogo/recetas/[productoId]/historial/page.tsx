import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { listarVersionesDeReceta } from "@/server/actions/recetas";

/**
 * Historial de versiones — separado del editor, mismo criterio que
 * separar "lista" de "editor" en la pantalla padre: la versión vigente
 * es la única editable, todo lo anterior es un registro de solo lectura
 * (append-only, nunca se pisa). Antes esos datos ya se guardaban pero no
 * había ninguna pantalla que los mostrara.
 */
export default async function HistorialRecetaPage({ params }: { params: Promise<{ productoId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "guardar_receta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { productoId } = await params;

  const [producto, versiones] = await Promise.all([
    prisma.producto.findUnique({ where: { id: productoId } }),
    listarVersionesDeReceta(productoId),
  ]);

  if (!producto) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-red-600">No se encontró ese producto.</p>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
      </div>
    );
  }

  const versionVigente = versiones[0]?.version;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/catalogo/recetas/${producto.id}`} className="text-sm underline">
          ← Volver a la receta
        </Link>
        <h1 className="mt-2 text-lg font-medium">Historial de {producto.nombre}</h1>
      </div>

      {versiones.length === 0 ? (
        <p className="text-sm text-neutral-500">Todavía no hay ninguna versión guardada.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {versiones.map((v) => (
            <div key={v.id} className="rounded border p-3">
              <h2 className="mb-2 text-sm font-medium">
                Versión {v.version}
                {v.version === versionVigente && <span className="ml-2 text-xs text-neutral-500">(vigente)</span>}
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  — {v.creadoEn.toLocaleDateString("es-AR")} {v.creadoEn.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-neutral-500">
                    <th className="py-1">Ingrediente</th>
                    <th>Cantidad</th>
                    <th>Unidad</th>
                    <th>Merma %</th>
                  </tr>
                </thead>
                <tbody>
                  {v.ingredientes.map((ing) => (
                    <tr key={ing.id} className="border-b last:border-0">
                      <td className="py-1">{ing.insumoProducto.nombre}</td>
                      <td>{Number(ing.cantidad)}</td>
                      <td>{ing.unidad.nombre}</td>
                      <td>{Number(ing.mermaPorcentaje)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
