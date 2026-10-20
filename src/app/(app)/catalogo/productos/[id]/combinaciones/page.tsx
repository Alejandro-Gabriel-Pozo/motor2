import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { fijarEjesDeCombinacion, fijarPrecioLocalDeCombinacion, guardarCombinacionDeProducto, guardarRecetaDeCombinacion } from "@/server/actions/catalogo/combinaciones";
import { cargarCombinacionesDelProducto } from "@/server/consultas/catalogo/combinaciones";
import type { CeldaDeCombinacion } from "@/core/catalogo/public";
import { formatearMonto } from "@/core/pos/public";
import { FormConResultado } from "@/components/form-con-resultado";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";

const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
/** Filas de la receta propia que se ofrecen además de las cargadas (para sumar ingredientes sin JavaScript). */
const FILAS_EXTRA_DE_RECETA = 3;
const CLASE_INPUT = "min-h-[44px] rounded border px-2 py-1";
const CLASE_BOTON = "min-h-[44px] rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900";

/**
 * «Combinaciones» de UN producto (GO-3b, ADR-032, F6 pasos U3 y U4): qué grupos son los EJES (el tamaño y la leche), y de cada combinación de sus opciones si se vende, con qué precio (propio o la
 * regla general de siempre; las tarifas compartidas se retiraron en la Fase 3), su precio en esta sucursal y su RECETA PROPIA (el flat white grande lleva 36 g de café, no «lo del mediano × 1,5»). Es una página de EDICIÓN: la
 * familia es la de la ficha (`producto_ver_catalogo`, el primer gate) y además exige Editar de `producto_opciones_admitidas`; la receta propia se edita con `guardar_receta` y el precio de la
 * sucursal con `precio_local` (sin ellos, se ven como texto). Cada formulario manda la versión que vio la pantalla: si otra persona guardó antes, el servidor lo dice y no pisa nada.
 */
export default async function CombinacionesDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db);
  if (!gateEditar.ok) return <p className="text-red-600">{gateEditar.mensaje}</p>;

  const { id } = await params;
  const [datos, nivelReceta, nivelPrecioLocal] = await Promise.all([
    cargarCombinacionesDelProducto(ctx.db, id, ctx.sucursalId),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db),
  ]);
  if (!datos) notFound();
  const productoId = datos.producto.id;
  const sucursalId = ctx.sucursalId;
  const volver = (
    <Link href={`/catalogo/productos/${productoId}/opciones`} className="text-sm underline">
      ← Opciones de venta de {datos.producto.nombre}
    </Link>
  );
  if (!datos.producto.esPV) return <div className="flex flex-col gap-2">{volver}<p className="text-red-600">Solo un producto de venta tiene combinaciones.</p></div>;

  const nombreDe = (c: CeldaDeCombinacion) => [c.opcionEje1.nombre, c.opcionEje2?.nombre].filter(Boolean).join(" · ");

  return (
    <GrupoDeFormularios className="flex max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        {volver}
        <h1 className="mt-2 text-xl font-semibold">Combinaciones de «{datos.producto.nombre}»</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Solo hace falta cargar lo que se sale de la regla general: una combinación que no se vende, un precio propio o una receta propia. Lo demás se cobra y se consume como siempre.
        </p>
      </div>

      <section aria-labelledby="titulo-ejes" className="flex flex-col gap-2">
        <h2 id="titulo-ejes" className="text-lg font-medium">
          Ejes
        </h2>
        {datos.posiblesEjes.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Para armar combinaciones, el producto tiene que admitir un tamaño o una variante de una sola elección obligatoria.</p>
        ) : (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              const eje1 = campo(fd, "eje1");
              const eje2 = campo(fd, "eje2");
              return fijarEjesDeCombinacion({ productoId, eje1GrupoId: eje1 || null, eje2GrupoId: eje2 || null });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            {(["eje1", "eje2"] as const).map((n, i) => (
              <label key={n} className="flex flex-col gap-1 text-sm">
                {i === 0 ? "Eje 1" : "Eje 2 (opcional)"}
                <select name={n} defaultValue={(i === 0 ? datos.ejes.eje1 : datos.ejes.eje2) ?? ""} className={CLASE_INPUT}>
                  <option value="">{i === 0 ? "Sin combinaciones" : "Ninguno"}</option>
                  {datos.posiblesEjes.map((g) => (
                    <option key={g.grupoId} value={g.grupoId}>
                      {g.nombre}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="submit" className={CLASE_BOTON}>
              Guardar ejes
            </button>
          </FormConResultado>
        )}
        {!datos.ejesValidos && datos.ejes.eje1 !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Los ejes ya no son válidos con lo que el producto admite hoy: el salón no puede venderlo hasta que los corrijas.
          </p>
        )}
      </section>

      {datos.eje1 && (
        <section aria-labelledby="titulo-grilla" className="flex flex-col gap-3">
          <h2 id="titulo-grilla" className="text-lg font-medium">
            {datos.eje2 ? `${datos.eje1.nombre} × ${datos.eje2.nombre}` : datos.eje1.nombre}
          </h2>
          <ul className="flex flex-col gap-3">
            {datos.celdas.map((c) => {
              const opcionEje1Id = c.opcionEje1.opcionId;
              const opcionEje2Id = c.opcionEje2?.opcionId ?? null;
              const versionEsperada = c.fila?.version ?? 0;
              const combinacionId = c.fila?.combinacionId ?? null;
              const nombre = nombreDe(c);
              const precioActual = c.fila?.precio != null ? formatearMonto(c.fila.precio) : c.precioAditivo !== null ? `${formatearMonto(c.precioAditivo)} (regla general)` : "regla general";
              const numeroEsperado = c.fila?.receta?.numero ?? 0;
              const localVisto = c.fila?.precioLocal ?? null;
              return (
                <li key={`${opcionEje1Id}|${opcionEje2Id ?? ""}`} className="rounded border p-3" data-combinacion={nombre}>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      <span className="font-medium">{nombre}</span> · {c.fila && !c.fila.activa ? "no se vende" : precioActual}
                      {c.fila?.receta && c.fila.receta.ingredientes.length > 0 ? " · receta propia" : ""}
                    </summary>
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const modo = campo(fd, "modo");
                        return guardarCombinacionDeProducto({
                          productoId,
                          opcionEje1Id,
                          opcionEje2Id,
                          versionEsperada,
                          activa: fd.get("activa") === "on",
                          precio: modo === "PROPIO" ? campo(fd, "precio") : null,
                        });
                      }}
                      className="mt-3 flex flex-wrap items-end gap-3 text-sm"
                    >
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="activa" defaultChecked={c.fila?.activa ?? true} /> Se vende
                      </label>
                      <label className="flex flex-col gap-1">
                        Precio
                        <select name="modo" defaultValue={c.fila?.precio != null ? "PROPIO" : "GENERAL"} className={CLASE_INPUT}>
                          <option value="GENERAL">Regla general{c.precioAditivo !== null ? ` (${formatearMonto(c.precioAditivo)})` : ""}</option>
                          <option value="PROPIO">Precio propio</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        Precio propio
                        <input name="precio" inputMode="decimal" defaultValue={c.fila?.precio ?? ""} className={`${CLASE_INPUT} w-28`} />
                      </label>
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar combinación
                      </button>
                    </FormConResultado>

                    {combinacionId && c.fila && c.fila.precio !== null && (
                      <div className="mt-3 text-sm" data-precio-local-combinacion={nombre}>
                        {nivelPrecioLocal.editar ? (
                          <FormConResultado
                            accion={async (fd: FormData) => {
                              "use server";
                              const texto = campo(fd, "precioLocal").trim();
                              return fijarPrecioLocalDeCombinacion({ sucursalId, combinacionId, esperado: localVisto, precio: texto === "" ? null : texto });
                            }}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <label className="flex flex-col gap-1">
                              Precio en «{ctx.sucursalNombre}» (vacío = el de la empresa)
                              <input name="precioLocal" inputMode="decimal" defaultValue={localVisto?.precio ?? ""} className={`${CLASE_INPUT} w-28`} />
                            </label>
                            <button type="submit" className={CLASE_BOTON}>
                              Guardar precio de esta sucursal
                            </button>
                          </FormConResultado>
                        ) : (
                          <p>Precio en «{ctx.sucursalNombre}»: {localVisto ? formatearMonto(localVisto.precio) : "el de la empresa"}</p>
                        )}
                      </div>
                    )}

                    {combinacionId && !datos.producto.seProduce && (
                      <div className="mt-4 flex flex-col gap-2 text-sm" data-receta-propia={nombre}>
                        <h3 className="font-medium">Receta propia{c.fila?.receta ? ` (versión ${c.fila.receta.numero})` : ""}</h3>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">
                          Sin ingredientes, vale la receta del producto ajustada por las opciones (la regla general). La venta congela la versión al agregar el ítem: cambiarla no cambia lo que ya está en una mesa.
                        </p>
                        {nivelReceta.editar ? (
                          <FormConResultado
                            accion={async (fd: FormData) => {
                              "use server";
                              const filas = fd.getAll("insumo").map(String);
                              const cantidades = fd.getAll("cantidad").map(String);
                              const mermas = fd.getAll("merma").map(String);
                              const ingredientes = filas.flatMap((insumoProductoId, i) =>
                                insumoProductoId ? [{ insumoProductoId, cantidad: cantidades[i] ?? "", ...(mermas[i] ? { mermaPorcentaje: mermas[i] } : {}) }] : []
                              );
                              return guardarRecetaDeCombinacion({ combinacionId, numeroEsperado, ingredientes });
                            }}
                            className="flex flex-col gap-2"
                          >
                            {[...(c.fila?.receta?.ingredientes ?? []), ...Array.from({ length: FILAS_EXTRA_DE_RECETA }, () => null)].map((ing, i) => (
                              <div key={i} className="flex flex-wrap items-end gap-2">
                                <label className="flex flex-col gap-1">
                                  Ingrediente {i + 1}
                                  <select name="insumo" defaultValue={ing?.insumoProductoId ?? ""} className={CLASE_INPUT}>
                                    <option value="">—</option>
                                    {datos.materiasPrimas.map((m) => (
                                      <option key={m.productoId} value={m.productoId}>
                                        {m.nombre} ({m.unidad})
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-1">
                                  Cantidad
                                  <input name="cantidad" inputMode="decimal" defaultValue={ing?.cantidad ?? ""} className={`${CLASE_INPUT} w-24`} />
                                </label>
                                <label className="flex flex-col gap-1">
                                  Merma %
                                  <input name="merma" inputMode="decimal" defaultValue={ing && ing.mermaPorcentaje ? ing.mermaPorcentaje : ""} className={`${CLASE_INPUT} w-20`} />
                                </label>
                              </div>
                            ))}
                            <div>
                              <button type="submit" className={CLASE_BOTON}>
                                Guardar receta propia
                              </button>
                            </div>
                          </FormConResultado>
                        ) : c.fila?.receta && c.fila.receta.ingredientes.length > 0 ? (
                          <ul className="list-disc pl-5">
                            {c.fila.receta.ingredientes.map((i) => (
                              <li key={i.insumoProductoId}>
                                {datos.materiasPrimas.find((m) => m.productoId === i.insumoProductoId)?.nombre ?? i.insumoProductoId}: {i.cantidad}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>Sin receta propia: vale la regla general.</p>
                        )}
                      </div>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </GrupoDeFormularios>
  );
}
