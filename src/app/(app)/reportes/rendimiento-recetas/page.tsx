import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer, obtenerMiNivelPermiso } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { calcularRendimientoRecetasSimples, calcularRendimientoRecetasCompartidas } from "@/core/reportes/rendimiento-recetas";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { AyudaIcono } from "@/components/ayuda-campo";
import { SelectorRango } from "@/components/selector-rango";
import { FilaRendimientoSimple } from "./fila-simple";
import { FilaRendimientoCompartida } from "./fila-compartida";

const AYUDA_RENDIMIENTO_REAL =
  "Total comprado ÷ total vendido en el rango de fechas elegido. Es una estimación indirecta, no una medición física: asume que lo que se compra en la ventana es lo que se consume en la ventana, algo que no siempre es cierto si comprás por lote (ej. caja x12).";
const AYUDA_DESVIO =
  "Diferencia entre Rendimiento real y Receta actual (con la merma ya aplicada). El texto chico debajo, cuando aparece, muestra cuánto puede moverse solo por comprar de a lotes — no decide si la celda se pinta ámbar, es contexto.";
const AYUDA_DELTA_STOCK = "Cuánto cambió el stock del insumo dentro de la ventana elegida (pasá el mouse para ver el saldo antes y después). Si subió, parte de lo comprado quedó en el depósito, no se consumió — no es, por sí solo, un error de receta.";
const AYUDA_IMPACTO = "(entradas reales − lo que la receta hubiera consumido) × costo de reposición — lo que ORDENA la tabla, no el %. Un desvío grande en un insumo barato puede pesar menos que uno moderado en un insumo caro.";

/** Mismo criterio que `hoyUtcSinHora`/"29 + hoy" de rango-por-defecto.ts — acá 55 + hoy = 56 días = 8 semanas exactas, inclusive los dos extremos. */
function fechaUtcIsoHaceNDias(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fases 1 y 2 del diseño (docs/diseno-rendimiento-recetas-por-sucursal.md):
 * compara la receta cargada contra lo que las compras/producción/ventas
 * reales de ESTA sucursal sugieren que realmente se consume. Corre siempre
 * para la sucursal activa, nunca mezclado con otras (ver §2.4 del diseño:
 * mezclar sucursales destruye la comparación entre cocineros).
 *
 * Es un CALIBRADOR de recetas, no un medidor de pérdidas — decisión 1 de §3
 * (docs/planes-demo-y-claridad-reportes-2026-09-21.md), confirmada por
 * grounding externo: los tres sistemas de referencia que modelan producción
 * separan esas dos preguntas, y motor2 ya tiene el medidor de pérdidas
 * construido (/reportes/diferencias + /reportes/perdidas).
 *
 * "Usar este valor" nunca aplica directo: cada fila pide confirmación con el porqué a la vista antes de ir al editor de
 * recetas (ver `fila-simple.tsx`/`fila-compartida.tsx`) — decisión del usuario, 2026-09-21, docs/planes-demo-y-claridad-
 * reportes-2026-09-21.md §3.
 */
export default async function RendimientoRecetasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; rango?: string; productoId?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;
  const desde = new Date(desdeStr);
  const hasta = new Date(hastaStr);

  const [todasLasSimples, todasLasCompartidas, { editar: puedeCalibrar }] = await Promise.all([
    calcularRendimientoRecetasSimples(ctx.sucursalId, desde, hasta),
    calcularRendimientoRecetasCompartidas(ctx.sucursalId, desde, hasta),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "calibrar_rendimiento_local"),
  ]);
  const filasSimples = sp.productoId ? todasLasSimples.filter((f) => f.productoVentaId === sp.productoId) : todasLasSimples;
  const filasCompartidas = sp.productoId ? todasLasCompartidas.filter((f) => f.productoVentaId === sp.productoId) : todasLasCompartidas;

  const nombreFiltrado = filasSimples[0]?.productoVentaNombre ?? filasCompartidas[0]?.productoVentaNombre;

  // B10: "barato" en vez de extender OpcionRango (razones en el plan §B10) — solo se ofrece cuando de verdad ayudaría.
  const confianzaLimitadaPorVentana = filasSimples.some((f) => f.confianza !== "alta") || filasCompartidas.some((f) => f.semanasConDatos < 8);
  const hrefUltimas8Semanas =
    `/reportes/rendimiento-recetas?rango=personalizado&desde=${fechaUtcIsoHaceNDias(55)}&hasta=${fechaUtcIsoHaceNDias(0)}` +
    (sp.productoId ? `&productoId=${sp.productoId}` : "");

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
        <p className="text-sm text-neutral-500">
          <strong>¿La receta cargada refleja lo que realmente se usa?</strong> Compara la receta contra lo que las compras, la
          producción y las ventas de esta sucursal sugieren que se consume.
        </p>
        <p className="mb-4 text-sm text-neutral-500">
          Esto no mide si te falta stock. Para eso están{" "}
          <EnlaceInterno href="/reportes/diferencias" className="underline">
            Diferencias de ajuste
          </EnlaceInterno>{" "}
          (qué se ajustó y qué dice el último conteo) y{" "}
          <EnlaceInterno href="/reportes/perdidas" className="underline">
            Pérdidas y consumo interno
          </EnlaceInterno>{" "}
          (qué se mermó o se consumió, valorizado).
        </p>
        <SelectorRango
          opcion={rango.opcion}
          desdeISO={desdeStr}
          hastaISO={hastaStr}
          camposOcultos={sp.productoId ? { productoId: sp.productoId } : undefined}
        />
        {confianzaLimitadaPorVentana && (
          <p className="mt-1 text-sm">
            <EnlaceInterno href={hrefUltimas8Semanas} className="underline">
              Ver las últimas 8 semanas
            </EnlaceInterno>{" "}
            <span className="text-neutral-500">— con más semanas de datos la confianza puede subir.</span>
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Un solo plato por insumo</h2>
        {filasSimples.length === 0 ? (
          <p className="text-sm text-neutral-500">Nada para comparar todavía en este caso.</p>
        ) : (
          <div className="max-w-6xl overflow-x-auto">
            <table className="w-full text-sm">
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
                  <th className="px-2">Comprado</th>
                  <th className="px-2">Vendido</th>
                  <th className="px-2">
                    Δ stock
                    <AyudaIcono texto={AYUDA_DELTA_STOCK} />
                  </th>
                  <th className="px-2">
                    Impacto del desvío
                    <AyudaIcono texto={AYUDA_IMPACTO} />
                  </th>
                  <th className="px-2">Confianza</th>
                  <th className="px-2"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {filasSimples.map((f) => (
                  <FilaRendimientoSimple
                    key={f.recetaIngredienteId}
                    productoVentaId={f.productoVentaId}
                    productoVentaNombre={f.productoVentaNombre}
                    insumoProductoId={f.insumoProductoId}
                    insumoONombre={f.insumoONombre}
                    recetaIngredienteId={f.recetaIngredienteId}
                    unidadRecetaNombre={f.unidadRecetaNombre}
                    cantidadActual={f.cantidadActual}
                    cantidadActualCentral={f.cantidadActualCentral}
                    calibradoLocal={f.calibradoLocal}
                    mermaActual={f.mermaActual}
                    cantidadEstimada={f.cantidadEstimada}
                    desviacionPorcentaje={f.desviacionPorcentaje}
                    motivoSinEstimacion={f.motivoSinEstimacion}
                    totalComprado={f.totalComprado}
                    totalProducido={f.totalProducido}
                    totalVendido={f.totalVendido}
                    stockApertura={f.stockApertura}
                    stockCierre={f.stockCierre}
                    bandaRuidoPct={f.bandaRuidoPct}
                    impactoPesos={f.impactoPesos}
                    sinCosto={f.sinCosto}
                    semanasConDatos={f.semanasConDatos}
                    confianza={f.confianza}
                    rotulo={f.rotulo}
                    sucursalId={ctx.sucursalId}
                    sucursalNombre={ctx.sucursalNombre}
                    puedeCalibrar={puedeCalibrar}
                  />
                ))}
              </tbody>
            </table>
          </div>
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
                <p className="mb-1 text-sm">
                  <strong>{filas[0].insumoONombre}</strong> — {filas[0].cantidadPlatosEnPool} platos, {filas[0].semanasConDatos} semanas con datos
                  {filas[0].resoluble && filas[0].r2 !== null && ` — ajuste R² ${filas[0].r2.toFixed(2)}`}
                </p>
                <p className="mb-2 text-xs text-neutral-500">
                  Del pool entero: comprado/producido {filas[0].totalEntradasPool} ·{" "}
                  <span title={`Antes de este rango: ${filas[0].stockApertura} — después: ${filas[0].stockCierre}`}>
                    Δ stock {filas[0].stockCierre - filas[0].stockApertura > 0 ? "+" : ""}
                    {filas[0].stockCierre - filas[0].stockApertura}
                  </span>
                  .
                </p>
                {!filas[0].resoluble && <p className="mb-2 text-sm text-amber-700 dark:text-amber-600">No se pudo estimar: {filas[0].motivoNoResoluble}</p>}
                <div className="overflow-x-auto">
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
                        <th className="px-2">Vendido</th>
                        <th className="px-2">
                          Impacto del desvío
                          <AyudaIcono texto={AYUDA_IMPACTO} />
                        </th>
                        <th className="px-2"><span className="sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f) => (
                        <FilaRendimientoCompartida
                          key={f.recetaIngredienteId}
                          productoVentaId={f.productoVentaId}
                          productoVentaNombre={f.productoVentaNombre}
                          insumoProductoId={f.insumoProductoId}
                          recetaIngredienteId={f.recetaIngredienteId}
                          unidadRecetaNombre={f.unidadRecetaNombre}
                          cantidadActual={f.cantidadActual}
                          cantidadActualCentral={f.cantidadActualCentral}
                          calibradoLocal={f.calibradoLocal}
                          mermaActual={f.mermaActual}
                          cantidadEstimada={f.cantidadEstimada}
                          desviacionPorcentaje={f.desviacionPorcentaje}
                          motivoSinEstimacion={f.motivoSinEstimacion}
                          totalVendido={f.totalVendido}
                          impactoPesos={f.impactoPesos}
                          sinCosto={f.sinCosto}
                          cantidadPlatosEnPool={f.cantidadPlatosEnPool}
                          semanasConDatos={f.semanasConDatos}
                          r2={f.r2}
                          rotulo={f.rotulo}
                          sucursalId={ctx.sucursalId}
                          sucursalNombre={ctx.sucursalNombre}
                          puedeCalibrar={puedeCalibrar}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
