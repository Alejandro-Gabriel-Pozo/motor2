import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import {
  calcularRendimientoRecetasSimples,
  calcularRendimientoRecetasCompartidas,
  type FilaRendimientoSimple,
} from "@/core/reportes/rendimiento-recetas";
import { AyudaIcono } from "@/components/ayuda-campo";

const AYUDA_RENDIMIENTO_REAL =
  "Total comprado ÷ total vendido en el rango de fechas elegido. Es una estimación indirecta, no una medición física: asume que lo que se compra en la ventana es lo que se consume en la ventana, algo que no siempre es cierto si comprás por lote (ej. caja x12).";
const AYUDA_DESVIO =
  "Diferencia entre Rendimiento real y Receta actual. En un producto de venta directa (1 a 1, sin preparación — ver \"venta directa\" en la fila) el desvío no puede ser un error de receta: es ruido de comprar por lote dentro de esta ventana de fechas, no necesariamente algo para corregir.";
const AYUDA_TRIVIAL =
  "Venta directa 1:1 sin preparación (1 unidad de receta, 0% merma) — un desvío acá no puede deberse a la receta en sí. Puede ser ruido de lote de compra, o señal real de rotura/robo no cargado como Merma.";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETA_CONFIANZA: Record<FilaRendimientoSimple["confianza"], string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
  sin_datos: "Sin datos",
};

function celdaDesvio(desviacionPorcentaje: number | null) {
  return (
    <td className={`px-2 py-2 ${desviacionPorcentaje !== null && Math.abs(desviacionPorcentaje) >= 10 ? "font-medium text-amber-700 dark:text-amber-600" : ""}`}>
      {desviacionPorcentaje !== null ? `${desviacionPorcentaje > 0 ? "+" : ""}${desviacionPorcentaje}%` : "—"}
    </td>
  );
}

function celdaUsarValor(productoVentaId: string, insumoProductoId: string, cantidadEstimada: number | null) {
  if (cantidadEstimada === null) return <td className="px-2 py-2" />;
  return (
    <td className="px-2 py-2">
      <EnlaceInterno href={`/catalogo/recetas/${productoVentaId}?editar=${insumoProductoId}&sugerido=${cantidadEstimada}`} className="text-sm underline">
        Usar este valor
      </EnlaceInterno>
    </td>
  );
}

/**
 * Fases 1 y 2 del diseño (docs/diseno-rendimiento-recetas-por-sucursal.md):
 * compara la receta cargada contra lo que las compras/ventas reales de
 * ESTA sucursal sugieren que realmente se consume. Corre siempre para la
 * sucursal activa, nunca mezclado con otras (ver §2.4 del diseño: mezclar
 * sucursales destruye la comparación entre cocineros).
 */
export default async function RendimientoRecetasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; productoId?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();
  const desde = new Date(desdeStr);
  const hasta = new Date(hastaStr);

  const [todasLasSimples, todasLasCompartidas] = await Promise.all([
    calcularRendimientoRecetasSimples(ctx.sucursalId, desde, hasta),
    calcularRendimientoRecetasCompartidas(ctx.sucursalId, desde, hasta),
  ]);
  const filasSimples = sp.productoId ? todasLasSimples.filter((f) => f.productoVentaId === sp.productoId) : todasLasSimples;
  const filasCompartidas = sp.productoId ? todasLasCompartidas.filter((f) => f.productoVentaId === sp.productoId) : todasLasCompartidas;

  const nombreFiltrado = filasSimples[0]?.productoVentaNombre ?? filasCompartidas[0]?.productoVentaNombre;

  const poolsCompartidos = new Map<string, typeof filasCompartidas>();
  for (const f of filasCompartidas) {
    if (!poolsCompartidos.has(f.poolClave)) poolsCompartidos.set(f.poolClave, []);
    poolsCompartidos.get(f.poolClave)!.push(f);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 text-xl font-semibold">
          Rendimiento real de recetas
          {sp.productoId && nombreFiltrado && ` — ${nombreFiltrado}`}
        </h1>
        {sp.productoId && (
          <Link href="/reportes/rendimiento-recetas" className="text-sm underline">
            Ver todos los platos
          </Link>
        )}
        <p className="mb-4 text-sm text-neutral-500">
          Compara la receta cargada contra lo que compras y ventas de esta sucursal sugieren que realmente se consume.
        </p>
        <form className="flex items-end gap-3 text-sm">
          {sp.productoId && <input type="hidden" name="productoId" value={sp.productoId} />}
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desdeStr} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hastaStr} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Un solo plato por insumo</h2>
        {filasSimples.length === 0 ? (
          <p className="text-sm text-neutral-500">Nada para comparar todavía en este caso.</p>
        ) : (
          <table className="w-full max-w-6xl text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="px-2 py-2 first:pl-0">Plato</th>
                <th className="px-2">Insumo</th>
                <th className="px-2">Receta actual</th>
                <th className="px-2">
                  Rendimiento real
                  <AyudaIcono texto={AYUDA_RENDIMIENTO_REAL} />
                </th>
                <th className="px-2">
                  Desvío
                  <AyudaIcono texto={AYUDA_DESVIO} />
                </th>
                <th className="px-2">Confianza</th>
                <th className="px-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filasSimples.map((f) => (
                <tr key={f.recetaIngredienteId} className="border-b">
                  <td className="px-2 py-2 first:pl-0">{f.productoVentaNombre}</td>
                  <td className="px-2 py-2">
                    {f.insumoONombre}
                    {f.esTrivial && (
                      <span className="ml-1 text-xs text-neutral-400">
                        (venta directa)
                        <AyudaIcono texto={AYUDA_TRIVIAL} />{" "}
                        <EnlaceInterno href={`/reportes/historial?productoId=${f.insumoProductoId}`} className="underline">
                          Ver historial
                        </EnlaceInterno>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {f.cantidadActual} {f.unidadRecetaNombre}
                  </td>
                  <td className="px-2 py-2">{f.cantidadEstimada !== null ? `${f.cantidadEstimada} ${f.unidadRecetaNombre}` : "—"}</td>
                  {celdaDesvio(f.desviacionPorcentaje)}
                  <td className="px-2 py-2">{ETIQUETA_CONFIANZA[f.confianza]}</td>
                  {celdaUsarValor(f.productoVentaId, f.insumoProductoId, f.cantidadEstimada)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Insumo compartido entre varios platos</h2>
        {poolsCompartidos.size === 0 ? (
          <p className="text-sm text-neutral-500">Nada para comparar todavía en este caso.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {Array.from(poolsCompartidos.entries()).map(([poolClave, filas]) => (
              <div key={poolClave} className="max-w-6xl">
                <p className="mb-2 text-sm">
                  <strong>{filas[0].insumoONombre}</strong> — {filas[0].cantidadPlatosEnPool} platos, {filas[0].semanasConDatos} semanas con datos
                  {filas[0].resoluble && filas[0].r2 !== null && ` — ajuste R² ${filas[0].r2.toFixed(2)}`}
                </p>
                {!filas[0].resoluble && <p className="mb-2 text-sm text-amber-700 dark:text-amber-600">No se pudo estimar: {filas[0].motivoNoResoluble}</p>}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-neutral-500">
                      <th className="px-2 py-2 first:pl-0">Plato</th>
                      <th className="px-2">Receta actual</th>
                      <th className="px-2">
                        Rendimiento real
                        <AyudaIcono texto={AYUDA_RENDIMIENTO_REAL} />
                      </th>
                      <th className="px-2">
                        Desvío
                        <AyudaIcono texto={AYUDA_DESVIO} />
                      </th>
                      <th className="px-2"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.recetaIngredienteId} className="border-b">
                        <td className="px-2 py-2 first:pl-0">
                          {f.productoVentaNombre}
                          {f.esTrivial && (
                            <span className="ml-1 text-xs text-neutral-400">
                              (venta directa)
                              <AyudaIcono texto={AYUDA_TRIVIAL} />{" "}
                              <EnlaceInterno href={`/reportes/historial?productoId=${f.insumoProductoId}`} className="underline">
                                Ver historial
                              </EnlaceInterno>
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {f.cantidadActual} {f.unidadRecetaNombre}
                        </td>
                        <td className="px-2 py-2">{f.cantidadEstimada !== null ? `${f.cantidadEstimada} ${f.unidadRecetaNombre}` : "—"}</td>
                        {celdaDesvio(f.desviacionPorcentaje)}
                        {celdaUsarValor(f.productoVentaId, f.insumoProductoId, f.cantidadEstimada)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
