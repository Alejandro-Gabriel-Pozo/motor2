import Link from "next/link";
import { redirect } from "next/navigation";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { IconoDeAccion } from "@/components/iconos";
import {
  actualizarIngredienteDeRecetaPropia,
  agregarIngredienteARecetaPropia,
  copiarRecetaPropiaDeOtraSucursal,
  crearRecetaPropiaDesdeLaCentral,
  quitarIngredienteDeRecetaPropia,
  volverALaRecetaCentral,
} from "@/server/actions/catalogo/receta-sucursal";
import type { listarSucursalesConRecetaPropia, obtenerEstadoDeRecetaPropia } from "@/server/consultas/catalogo/receta-propia";

type EstadoDeRecetaPropia = Awaited<ReturnType<typeof obtenerEstadoDeRecetaPropia>>;

/**
 * Bloque «Receta de esta sucursal» del editor de recetas (ADR-009, R3/R4): la receta propia de la sucursal activa para este producto —
 * crearla desde la central, editar sus ingredientes, copiarla de otra sucursal, volver a la central— y el aviso «la central cambió». Cada
 * formulario se muestra según el permiso de SU acción (`receta_sucursal_editar`/`_copiar`/`_volver_central`); sin ninguno, queda el estado
 * en texto. Las acciones son adaptadores finos: el permiso, la validación y la auditoría viven en `server/actions/catalogo/receta-sucursal.ts`.
 */
export function RecetaDeLaSucursal({
  producto,
  sucursalNombre,
  estado,
  otrasConRecetaPropia,
  puede,
  unidades,
  materiasPrimas,
  ingredienteEnEdicion,
  volver,
}: {
  producto: { id: string; nombre: string };
  sucursalNombre: string;
  estado: EstadoDeRecetaPropia;
  otrasConRecetaPropia: Awaited<ReturnType<typeof listarSucursalesConRecetaPropia>>;
  puede: { editar: boolean; copiar: boolean; volverALaCentral: boolean };
  unidades: { id: string; nombre: string }[];
  materiasPrimas: { id: string; nombre: string }[];
  ingredienteEnEdicion: string | null;
  volver: string;
}) {
  const { habilitada, propia, centralVigente, centralCambio, versionesPropias } = estado;
  const sinNadaQueHacer = !puede.editar && !puede.copiar && !puede.volverALaCentral;

  return (
    <section aria-labelledby="receta-de-la-sucursal" className="flex flex-col gap-3 rounded border p-3">
      <h2 id="receta-de-la-sucursal" className="font-medium">
        Receta de esta sucursal — {sucursalNombre}
      </h2>

      {habilitada && propia ? (
        <p className="text-sm">
          Esta sucursal usa su <strong>receta propia</strong> (versión {propia.version}) en lugar de la central: es la que rige para vender, consumir y costear acá. Las
          calibraciones de rendimiento de la sucursal quedan guardadas, pero no se aplican mientras la receta propia esté activa.
        </p>
      ) : (
        <p className="text-sm">
          Esta sucursal usa la <strong>receta central</strong>
          {centralVigente ? ` (versión ${centralVigente.version})` : " (este producto todavía no tiene una)"}.
          {versionesPropias > 0 && ` Antes tuvo receta propia: sus ${versionesPropias} versiones quedaron en el historial.`}
        </p>
      )}

      {centralCambio && centralVigente && (
        <p role="status" className="rounded border border-amber-600 p-2 text-sm text-amber-800 dark:text-amber-500">
          La receta central cambió (ahora va por la versión {centralVigente.version}) desde que se armó la receta propia de esta sucursal. No se aplicó nada: revisala y,
          si querés, ajustá la propia.
        </p>
      )}

      {habilitada && propia && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Ingredientes de la receta propia de {sucursalNombre}</caption>
            <thead>
              <tr>
                <th scope="col">Ingrediente</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Unidad</th>
                <th scope="col">Merma %</th>
                {puede.editar && <th scope="col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {propia.ingredientes.map((ing) => {
                const enEdicion = puede.editar && ingredienteEnEdicion === ing.insumoProductoId;
                return (
                  <tr key={ing.id} className="border-t">
                    {enEdicion ? (
                      <td colSpan={5} className="py-2">
                        <FormConResultado
                          accion={async (formData: FormData) => {
                            "use server";
                            const resultado = await actualizarIngredienteDeRecetaPropia(producto.id, ing.insumoProductoId, {
                              cantidad: Number(formData.get("cantidad")),
                              unidadId: String(formData.get("unidadId") ?? ""),
                              mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
                            });
                            if (resultado.ok) redirect(volver);
                            return resultado;
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <span className="text-sm font-medium">{ing.insumoProducto.nombre}</span>
                          <CampoNumero name="cantidad" defaultValue={String(Number(ing.cantidad))} required ariaLabel={`Cantidad de ${ing.insumoProducto.nombre} en la receta propia`} className="w-28" />
                          <select name="unidadId" defaultValue={ing.unidadId} required aria-label={`Unidad de ${ing.insumoProducto.nombre} en la receta propia`} className="rounded border px-2 py-1.5 text-sm">
                            {unidades.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.nombre}
                              </option>
                            ))}
                          </select>
                          <CampoNumero name="mermaPorcentaje" defaultValue={String(Number(ing.mermaPorcentaje))} ariaLabel={`Merma de ${ing.insumoProducto.nombre} en la receta propia`} placeholder="Merma %" className="w-24" />
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
                        {puede.editar && (
                          <td>
                            <div className="flex gap-3">
                              <Link href={`${volver}?editarPropia=${ing.insumoProductoId}`} className="inline-flex items-center gap-1 text-sm underline">
                                <IconoDeAccion id="editar" />
                                Editar<span className="sr-only"> {ing.insumoProducto.nombre} en la receta propia</span>
                              </Link>
                              <FormConResultado
                                accion={async () => {
                                  "use server";
                                  return quitarIngredienteDeRecetaPropia(producto.id, ing.insumoProductoId);
                                }}
                              >
                                <button type="submit" className="inline-flex items-center gap-1 text-sm underline">
                                  <IconoDeAccion id="eliminar" />
                                  Quitar<span className="sr-only"> {ing.insumoProducto.nombre} de la receta propia</span>
                                </button>
                              </FormConResultado>
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {puede.editar && !habilitada && centralVigente && (
        <FormConResultado
          accion={async () => {
            "use server";
            return crearRecetaPropiaDesdeLaCentral(producto.id);
          }}
          className="flex flex-col gap-2"
        >
          <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-sm text-white">
            Crear receta propia a partir de la central
          </button>
        </FormConResultado>
      )}

      {puede.editar && (habilitada || !centralVigente) && (
        <AgregarColapsable etiqueta="Agregar ingrediente a la receta de la sucursal">
          <FormConResultado
            accion={async (formData: FormData) => {
              "use server";
              return agregarIngredienteARecetaPropia(producto.id, {
                insumoProductoId: String(formData.get("insumoProductoId") ?? ""),
                cantidad: Number(formData.get("cantidad")),
                unidadId: String(formData.get("unidadId") ?? ""),
                mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
              });
            }}
            className="flex max-w-lg flex-col gap-2"
          >
            <h3 className="font-medium">Agregar ingrediente a la receta de {sucursalNombre} (genera su próxima versión)</h3>
            <select name="insumoProductoId" required aria-label="Materia prima de la receta propia" className="rounded border px-3 py-2">
              <option value="">Materia prima</option>
              {materiasPrimas.map((mp) => (
                <option key={mp.id} value={mp.id}>
                  {mp.nombre}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <CampoNumero name="cantidad" placeholder="Cantidad" ariaLabel="Cantidad en la receta propia" required className="flex-1" />
              <select name="unidadId" required aria-label="Unidad en la receta propia" className="flex-1 rounded border px-3 py-2">
                <option value="">Unidad</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              <CampoNumero name="mermaPorcentaje" placeholder="Merma %" ariaLabel="Merma en la receta propia" className="w-28" />
            </div>
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Agregar a la receta propia
            </button>
          </FormConResultado>
        </AgregarColapsable>
      )}

      {puede.copiar && otrasConRecetaPropia.length > 0 && (
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return copiarRecetaPropiaDeOtraSucursal(producto.id, String(formData.get("sucursalOrigenId") ?? ""), formData.get("confirmar") === "on");
          }}
          className="flex max-w-lg flex-col gap-2 border-t pt-3"
        >
          <h3 className="font-medium">Copiar la receta propia de otra sucursal</h3>
          <label className="flex flex-col gap-1 text-sm">
            Copiar desde
            <select name="sucursalOrigenId" required className="rounded border px-3 py-2">
              <option value="">Sucursal</option>
              {otrasConRecetaPropia.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirmar" required className="mt-1" />
            Entiendo que la receta de {sucursalNombre} pasa a ser una copia de esa y que la actual, si hay, queda en el historial.
          </label>
          <button type="submit" className="self-start rounded border px-4 py-2 text-sm">
            Copiar receta
          </button>
        </FormConResultado>
      )}

      {puede.volverALaCentral && habilitada && (
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return volverALaRecetaCentral(producto.id, formData.get("confirmar") === "on");
          }}
          className="flex max-w-lg flex-col gap-2 border-t pt-3"
        >
          <h3 className="font-medium">Volver a la receta central</h3>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirmar" required className="mt-1" />
            Entiendo que {sucursalNombre} deja de usar su receta propia de {producto.nombre} y pasa a usar la central; la propia queda en el historial.
          </label>
          <button type="submit" className="self-start rounded border px-4 py-2 text-sm">
            Volver a la receta central
          </button>
        </FormConResultado>
      )}

      {sinNadaQueHacer && <p className="text-sm text-neutral-500">Tu rol no puede cambiar la receta de esta sucursal.</p>}
    </section>
  );
}
