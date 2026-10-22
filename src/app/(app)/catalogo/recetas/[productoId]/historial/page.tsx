import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { listarVersionesDeReceta } from "@/server/actions/catalogo/recetas";
import { obtenerProductoPorId } from "@/server/consultas/catalogo/productos";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";

/**
 * Historial de versiones — separado del editor, mismo criterio que
 * separar "lista" de "editor" en la pantalla padre: la versión vigente
 * es la única editable, todo lo anterior es un registro de solo lectura
 * (append-only, nunca se pisa). Antes esos datos ya se guardaban pero no
 * había ninguna pantalla que los mostrara.
 */
export default async function HistorialRecetaPage({ params }: { params: Promise<{ productoId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { productoId } = await params;

  const [producto, versiones] = await Promise.all([
    obtenerProductoPorId(productoId, ctx.db),
    listarVersionesDeReceta(productoId),
  ]);

  if (!producto) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-error">No se encontró ese producto.</p>
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
        <p className="text-sm text-tinta-tenue">Todavía no hay ninguna versión guardada.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {versiones.map((v) => (
            <div key={v.id} className="rounded border p-3">
              <h2 className="mb-2 text-sm font-medium">
                Versión {v.version}
                {v.version === versionVigente && <span className="ml-2 text-xs text-tinta-tenue">(vigente)</span>}
                <span className="ml-2 text-xs font-normal text-tinta-tenue">
                  — {formatearFechaHora(v.creadoEn, ctx.empresaZonaHoraria)}
                </span>
              </h2>
              {(() => {
                const detalles: string[] = [];
                if (v.rendimientoCantidad != null) detalles.push(`Rendimiento: ${Number(v.rendimientoCantidad)} ${v.rendimientoUnidad?.nombre ?? ""}`.trim());
                if (v.racionesCantidad != null) detalles.push(`Raciones: ${v.racionesCantidad}`);
                if (v.racionTamano != null) detalles.push(`Tamaño de ración: ${Number(v.racionTamano)} ${v.racionUnidad?.nombre ?? ""}`.trim());
                if (v.tiempoPreparacionMinutos != null) detalles.push(`Prep.: ${v.tiempoPreparacionMinutos} min`);
                if (v.tiempoCoccionMinutos != null) detalles.push(`Cocción: ${v.tiempoCoccionMinutos} min`);
                return detalles.length > 0 ? <p className="mb-2 text-xs text-tinta-tenue">{detalles.join(" — ")}</p> : null;
              })()}
              {v.comentarios && <p className="mb-2 text-xs text-tinta-tenue">Comentarios: {v.comentarios}</p>}

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-tinta-tenue">
                    <th className="py-1">Ingrediente</th>
                    <th>Cantidad</th>
                    <th>Unidad</th>
                    <th>Merma %</th>
                  </tr>
                </thead>
                <tbody>
                  {v.ingredientes.map((ing) => (
                    <tr key={ing.id} className="border-b last:border-0">
                      <td className="py-1">
                        {ing.insumoProducto.nombre}
                        {ing.sustitutos.length > 0 && (
                          <p className="text-xs text-tinta-tenue">Sustitutos: {ing.sustitutos.map((s) => s.insumoSustituto.nombre).join(" → ")}</p>
                        )}
                      </td>
                      <td>{Number(ing.cantidad)}</td>
                      <td>{ing.unidad.nombre}</td>
                      <td>{Number(ing.mermaPorcentaje)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {v.pasos.length > 0 && (
                <div className="mt-3">
                  <h3 className="mb-1 text-xs font-medium text-tinta-tenue">Método de preparación</h3>
                  <ol className="flex flex-col gap-1 text-sm">
                    {v.pasos.map((paso) => (
                      <li key={paso.id}>
                        <span className="font-medium">
                          {paso.orden}. {paso.nombre || "Paso"}
                        </span>
                        {paso.minutos != null && <span className="text-xs text-tinta-tenue"> ({paso.minutos} min)</span>}
                        <p className="text-tinta-suave">{paso.instruccion}</p>
                        {paso.ingredientes.length > 0 && (
                          <p className="text-xs text-tinta-tenue">
                            Ingredientes: {paso.ingredientes.map((pi) => pi.recetaIngrediente.insumoProducto.nombre).join(", ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
