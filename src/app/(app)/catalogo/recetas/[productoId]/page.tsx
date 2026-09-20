import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import {
  obtenerRecetaVigente,
  agregarIngredienteAReceta,
  actualizarIngredienteDeReceta,
  quitarIngredienteDeReceta,
  agregarPasoAReceta,
  reordenarPasosDeReceta,
  insertarPasoEnReceta,
  actualizarPasoDeReceta,
  quitarPasoDeReceta,
  actualizarCabeceraDeReceta,
} from "@/server/actions/catalogo/recetas";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { secuenciaMoviendo } from "@/core/catalogo/pasos-receta";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { AgregarColapsable } from "@/components/agregar-colapsable";

export default async function RecetaEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ productoId: string }>;
  searchParams: Promise<{ editar?: string; sugerido?: string; editarPaso?: string; editarFicha?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "guardar_receta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { productoId } = await params;
  const { editar, sugerido, editarPaso, editarFicha } = await searchParams;
  const ordenEnEdicion = editarPaso ? Number(editarPaso) : null;

  const [producto, mpActivas, unidades] = await Promise.all([
    prisma.producto.findUnique({ where: { id: productoId } }),
    prisma.producto.findMany({ where: { tipo: "MP", activo: true }, orderBy: { nombre: "asc" } }),
    listarUnidadesActivas(),
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

  const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
  if (!elegible) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-red-600">
          &quot;{producto.nombre}&quot; no puede tener receta — tiene que ser un Producto de venta, o una Materia prima marcada &quot;Se
          produce&quot;.
        </p>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
      </div>
    );
  }

  const vigente = await obtenerRecetaVigente(producto.id);
  const volver = `/catalogo/recetas/${producto.id}`;
  const siguienteOrdenPaso = vigente?.pasos.length ? Math.max(...vigente.pasos.map((p) => p.orden)) + 1 : 1;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
        <h1 className="mt-2 text-lg font-medium">
          {producto.nombre} — versión vigente: {vigente?.version ?? "sin receta todavía"}
        </h1>
        {vigente && (
          <div className="flex gap-3">
            <Link href={`${volver}/historial`} className="text-sm text-neutral-500 underline">
              Ver historial de versiones ({vigente.version})
            </Link>
            <EnlaceInterno href={`/reportes/rendimiento-recetas?productoId=${producto.id}`} className="text-sm text-neutral-500 underline">
              Ver rendimiento real
            </EnlaceInterno>
          </div>
        )}
      </div>

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Ficha técnica</h2>
          {editarFicha ? (
            <FormConResultado
              accion={async (formData: FormData) => {
                "use server";
                const resultado = await actualizarCabeceraDeReceta(producto.id, {
                  rendimientoCantidad: formData.get("rendimientoCantidad") ? Number(formData.get("rendimientoCantidad")) : undefined,
                  rendimientoUnidadId: String(formData.get("rendimientoUnidadId") ?? "") || undefined,
                  racionesCantidad: formData.get("racionesCantidad") ? Number(formData.get("racionesCantidad")) : undefined,
                  racionTamano: formData.get("racionTamano") ? Number(formData.get("racionTamano")) : undefined,
                  racionUnidadId: String(formData.get("racionUnidadId") ?? "") || undefined,
                  tiempoPreparacionMinutos: formData.get("tiempoPreparacionMinutos") ? Number(formData.get("tiempoPreparacionMinutos")) : undefined,
                  tiempoCoccionMinutos: formData.get("tiempoCoccionMinutos") ? Number(formData.get("tiempoCoccionMinutos")) : undefined,
                  comentarios: String(formData.get("comentarios") ?? ""),
                  presentacionEmplatado: String(formData.get("presentacionEmplatado") ?? ""),
                  notasAdicionales: String(formData.get("notasAdicionales") ?? ""),
                  equipamientoNecesario: String(formData.get("equipamientoNecesario") ?? ""),
                });
                // Sale del modo edición al guardar — mismo criterio que Ingredientes/Pasos.
                if (resultado.ok) redirect(volver);
                return resultado;
              }}
              className="flex flex-col gap-2 text-sm"
            >
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1">
                  Rendimiento
                  <div className="flex gap-1">
                    <CampoNumero name="rendimientoCantidad" defaultValue={vigente.rendimientoCantidad ? String(Number(vigente.rendimientoCantidad)) : ""} className="w-24" tamano="compacto" />
                    <select name="rendimientoUnidadId" defaultValue={vigente.rendimientoUnidadId ?? ""} className="rounded border px-2 py-1.5 text-sm">
                      <option value="">Unidad</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  Raciones
                  <CampoNumero name="racionesCantidad" defaultValue={vigente.racionesCantidad ? String(vigente.racionesCantidad) : ""} className="w-20" tamano="compacto" />
                </label>
                <label className="flex flex-col gap-1">
                  Tamaño de ración
                  <div className="flex gap-1">
                    <CampoNumero name="racionTamano" defaultValue={vigente.racionTamano ? String(Number(vigente.racionTamano)) : ""} className="w-24" tamano="compacto" />
                    <select name="racionUnidadId" defaultValue={vigente.racionUnidadId ?? ""} className="rounded border px-2 py-1.5 text-sm">
                      <option value="">Unidad</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  Prep. (min)
                  <CampoNumero name="tiempoPreparacionMinutos" defaultValue={vigente.tiempoPreparacionMinutos ? String(vigente.tiempoPreparacionMinutos) : ""} className="w-20" tamano="compacto" />
                </label>
                <label className="flex flex-col gap-1">
                  Cocción (min)
                  <CampoNumero name="tiempoCoccionMinutos" defaultValue={vigente.tiempoCoccionMinutos ? String(vigente.tiempoCoccionMinutos) : ""} className="w-20" tamano="compacto" />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                Comentarios
                <textarea name="comentarios" defaultValue={vigente.comentarios ?? ""} className="rounded border px-3 py-2" rows={2} />
              </label>
              <label className="flex flex-col gap-1">
                Presentación o emplatado
                <textarea name="presentacionEmplatado" defaultValue={vigente.presentacionEmplatado ?? ""} placeholder="Un renglón por ítem" className="rounded border px-3 py-2" rows={2} />
              </label>
              <label className="flex flex-col gap-1">
                Notas adicionales
                <textarea name="notasAdicionales" defaultValue={vigente.notasAdicionales ?? ""} placeholder="Un renglón por ítem" className="rounded border px-3 py-2" rows={2} />
              </label>
              <label className="flex flex-col gap-1">
                Equipamiento necesario
                <textarea name="equipamientoNecesario" defaultValue={vigente.equipamientoNecesario ?? ""} placeholder="Un renglón por ítem" className="rounded border px-3 py-2" rows={2} />
              </label>
              <div className="flex gap-3">
                <button type="submit" className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
                  Guardar ficha técnica
                </button>
                <Link href={volver} className="self-center text-sm underline">
                  Cancelar
                </Link>
              </div>
            </FormConResultado>
          ) : (
            (() => {
              const detalles: string[] = [];
              if (vigente.rendimientoCantidad != null) detalles.push(`Rendimiento: ${Number(vigente.rendimientoCantidad)} ${vigente.rendimientoUnidad?.nombre ?? ""}`.trim());
              if (vigente.racionesCantidad != null) detalles.push(`Raciones: ${vigente.racionesCantidad}`);
              if (vigente.racionTamano != null) detalles.push(`Tamaño de ración: ${Number(vigente.racionTamano)} ${vigente.racionUnidad?.nombre ?? ""}`.trim());
              if (vigente.tiempoPreparacionMinutos != null) detalles.push(`Prep.: ${vigente.tiempoPreparacionMinutos} min`);
              if (vigente.tiempoCoccionMinutos != null) detalles.push(`Cocción: ${vigente.tiempoCoccionMinutos} min`);
              return (
                <div className="flex flex-col gap-1 text-sm">
                  {detalles.length > 0 ? <p>{detalles.join(" — ")}</p> : <p className="text-neutral-500">Sin ficha técnica cargada.</p>}
                  {vigente.comentarios && <p className="text-neutral-500">Comentarios: {vigente.comentarios}</p>}
                  {vigente.presentacionEmplatado && <p className="text-neutral-500">Presentación o emplatado: {vigente.presentacionEmplatado}</p>}
                  {vigente.notasAdicionales && <p className="text-neutral-500">Notas adicionales: {vigente.notasAdicionales}</p>}
                  {vigente.equipamientoNecesario && <p className="text-neutral-500">Equipamiento necesario: {vigente.equipamientoNecesario}</p>}
                  <Link href={`${volver}?editarFicha=1`} className="self-start underline">
                    Editar
                  </Link>
                </div>
              );
            })()
          )}
        </div>
      )}

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Ingredientes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Ingrediente</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Merma %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vigente.ingredientes.map((ing) => {
                const enEdicion = editar === ing.insumoProductoId;
                return (
                  <tr key={ing.id} className="border-b">
                    {enEdicion ? (
                      <td colSpan={5} className="py-2">
                        <FormConResultado
                          accion={async (formData: FormData) => {
                            "use server";
                            const resultado = await actualizarIngredienteDeReceta(producto.id, ing.insumoProductoId, {
                              cantidad: Number(formData.get("cantidad")),
                              unidadId: String(formData.get("unidadId") ?? ""),
                              mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
                            });
                            // Sale del modo edición al guardar — si no, `editar=` queda pegado en la URL y la fila se muestra siempre editable.
                            if (resultado.ok) redirect(volver);
                            return resultado;
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <span className="text-sm font-medium">{ing.insumoProducto.nombre}</span>
                          <CampoNumero name="cantidad" defaultValue={sugerido || String(Number(ing.cantidad))} required className="w-28" />
                          {sugerido && <span className="text-xs text-neutral-500">(sugerido por rendimiento real — tenías {Number(ing.cantidad)})</span>}
                          <select name="unidadId" defaultValue={ing.unidadId} required className="rounded border px-2 py-1.5 text-sm">
                            {unidades.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.nombre}
                              </option>
                            ))}
                          </select>
                          <CampoNumero name="mermaPorcentaje" defaultValue={String(Number(ing.mermaPorcentaje))} placeholder="Merma %" className="w-24" />
                          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
                            Guardar
                          </button>
                          <Link href={volver} className="text-sm underline">
                            Cancelar
                          </Link>
                        </FormConResultado>
                      </td>
                    ) : (
                      <>
                        <td className="py-2">{ing.insumoProducto.nombre}</td>
                        <td>{Number(ing.cantidad)}</td>
                        <td>{ing.unidad.nombre}</td>
                        <td>{Number(ing.mermaPorcentaje)}</td>
                        <td className="flex gap-3">
                          <Link href={`${volver}?editar=${ing.insumoProductoId}`} className="text-sm underline">
                            Editar
                          </Link>
                          <FormConResultado
                            accion={async () => {
                              "use server";
                              return quitarIngredienteDeReceta(producto.id, ing.insumoProductoId);
                            }}
                          >
                            <button type="submit" className="text-sm underline">
                              Quitar
                            </button>
                          </FormConResultado>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AgregarColapsable etiqueta="Agregar ingrediente">
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return agregarIngredienteAReceta(producto.id, {
              insumoProductoId: String(formData.get("insumoProductoId") ?? ""),
              cantidad: Number(formData.get("cantidad")),
              unidadId: String(formData.get("unidadId") ?? ""),
              mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
            });
          }}
          className="flex max-w-lg flex-col gap-2"
        >
          <h3 className="font-medium">Agregar ingrediente (genera la próxima versión)</h3>
          <select name="insumoProductoId" required className="rounded border px-3 py-2">
            <option value="">Materia prima</option>
            {mpActivas.map((mp) => (
              <option key={mp.id} value={mp.id}>
                {mp.nombre}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <CampoNumero name="cantidad" placeholder="Cantidad" required className="flex-1" />
            <select name="unidadId" required className="flex-1 rounded border px-3 py-2">
              <option value="">Unidad</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
            <CampoNumero name="mermaPorcentaje" placeholder="Merma %" className="w-28" />
          </div>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Agregar
          </button>
        </FormConResultado>
      </AgregarColapsable>

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Método de preparación</h2>
          {vigente.pasos.length === 0 ? (
            <p className="text-sm text-neutral-500">Todavía no hay ningún paso cargado.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {vigente.pasos.map((paso, indice) => {
                const enEdicion = ordenEnEdicion === paso.orden;
                const ordenesVigentes = vigente.pasos.map((p) => p.orden);
                return (
                  <li key={paso.id} className="rounded border p-3 text-sm">
                    {enEdicion ? (
                      <FormConResultado
                        accion={async (formData: FormData) => {
                          "use server";
                          const resultado = await actualizarPasoDeReceta(producto.id, paso.orden, {
                            nombre: String(formData.get("nombre") ?? ""),
                            instruccion: String(formData.get("instruccion") ?? ""),
                            minutos: formData.get("minutos") ? Number(formData.get("minutos")) : undefined,
                            insumoProductoIds: formData.getAll("insumoProductoIds").map(String),
                          });
                          if (resultado.ok) redirect(volver);
                          return resultado;
                        }}
                        className="flex flex-col gap-2"
                      >
                        <input name="nombre" defaultValue={paso.nombre ?? ""} placeholder="Nombre corto (opcional)" className="rounded border px-2 py-1.5" />
                        <textarea name="instruccion" defaultValue={paso.instruccion} required className="rounded border px-2 py-1.5" rows={2} />
                        <CampoNumero name="minutos" defaultValue={paso.minutos ? String(paso.minutos) : ""} placeholder="Minutos (opcional)" className="w-32" tamano="compacto" />
                        {vigente.ingredientes.length > 0 && (
                          <fieldset className="flex flex-col gap-1">
                            <span className="text-xs text-neutral-500">¿Este paso usa solo algunos ingredientes en particular? (opcional)</span>
                            {vigente.ingredientes.map((ing) => (
                              <label key={ing.id} className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  name="insumoProductoIds"
                                  value={ing.insumoProductoId}
                                  defaultChecked={paso.ingredientes.some((pi) => pi.recetaIngrediente.insumoProductoId === ing.insumoProductoId)}
                                />
                                {ing.insumoProducto.nombre}
                              </label>
                            ))}
                          </fieldset>
                        )}
                        <div className="flex gap-3">
                          <button type="submit" className="self-start rounded bg-neutral-900 px-3 py-1.5 text-xs text-white">
                            Guardar
                          </button>
                          <Link href={volver} className="text-xs underline">
                            Cancelar
                          </Link>
                        </div>
                      </FormConResultado>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium">
                            {paso.orden}. {paso.nombre || "Paso"}
                          </span>
                          {paso.minutos != null && <span className="text-xs text-neutral-500">({paso.minutos} min)</span>}
                        </div>
                        <p>{paso.instruccion}</p>
                        {paso.ingredientes.length > 0 && (
                          <p className="text-xs text-neutral-500">
                            Ingredientes de este paso: {paso.ingredientes.map((pi) => pi.recetaIngrediente.insumoProducto.nombre).join(", ")}
                          </p>
                        )}
                        <div className="flex gap-3">
                          <Link href={`${volver}?editarPaso=${paso.orden}`} className="text-xs underline">
                            Editar
                          </Link>
                          <FormConResultado
                            accion={async () => {
                              "use server";
                              return quitarPasoDeReceta(producto.id, paso.orden);
                            }}
                          >
                            <button type="submit" className="text-xs underline">
                              Quitar
                            </button>
                          </FormConResultado>
                          {indice > 0 && (
                            <FormConResultado
                              accion={async () => {
                                "use server";
                                return reordenarPasosDeReceta(producto.id, secuenciaMoviendo(ordenesVigentes, paso.orden, "arriba"));
                              }}
                            >
                              <button type="submit" className="text-xs underline">
                                Subir
                              </button>
                            </FormConResultado>
                          )}
                          {indice < vigente.pasos.length - 1 && (
                            <FormConResultado
                              accion={async () => {
                                "use server";
                                return reordenarPasosDeReceta(producto.id, secuenciaMoviendo(ordenesVigentes, paso.orden, "abajo"));
                              }}
                            >
                              <button type="submit" className="text-xs underline">
                                Bajar
                              </button>
                            </FormConResultado>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          <AgregarColapsable etiqueta="Agregar paso">
            <FormConResultado
              accion={async (formData: FormData) => {
                "use server";
                const datos = {
                  nombre: String(formData.get("nombre") ?? ""),
                  instruccion: String(formData.get("instruccion") ?? ""),
                  minutos: formData.get("minutos") ? Number(formData.get("minutos")) : undefined,
                  insumoProductoIds: formData.getAll("insumoProductoIds").map(String),
                };
                const posicion = String(formData.get("posicion") ?? "final");
                if (posicion === "final") return agregarPasoAReceta(producto.id, { orden: siguienteOrdenPaso, ...datos });
                return insertarPasoEnReceta(producto.id, Number(posicion), datos);
              }}
              className="flex max-w-lg flex-col gap-2"
            >
              <h3 className="text-sm font-medium">Agregar paso (genera la próxima versión)</h3>
              {vigente.pasos.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-neutral-500">
                  Posición
                  <select name="posicion" defaultValue="final" className="rounded border px-2 py-1.5 text-sm text-neutral-900">
                    <option value="final">Al final</option>
                    {vigente.pasos.map((_, indice) => (
                      <option key={indice} value={indice + 1}>
                        Antes del paso {indice + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <input name="nombre" placeholder="Nombre corto (opcional)" className="rounded border px-3 py-2" />
              <textarea name="instruccion" placeholder="Instrucción" required className="rounded border px-3 py-2" rows={2} />
              <CampoNumero name="minutos" placeholder="Minutos (opcional)" className="w-32" />
              {vigente.ingredientes.length > 0 && (
                <fieldset className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">¿Este paso usa solo algunos ingredientes en particular? (opcional)</span>
                  {vigente.ingredientes.map((ing) => (
                    <label key={ing.id} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="insumoProductoIds" value={ing.insumoProductoId} />
                      {ing.insumoProducto.nombre}
                    </label>
                  ))}
                </fieldset>
              )}
              <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-white">
                Agregar paso
              </button>
            </FormConResultado>
          </AgregarColapsable>
        </div>
      )}
    </div>
  );
}
